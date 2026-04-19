// Phase 3 bitmap-sub shim (see docs/native-video-pipeline.md). Exports
// pure-C symbols picked up by Swift via @_silgen_name in
// HybridNativeMpv.swift — no bridging header / modulemap needed for
// an opaque-handle C API.
//
// MPVKit's FFmpeg public headers ship WITHOUT `extern "C"` guards.
// This file compiles as Objective-C++ (pod-wide GCC_INPUT_FILETYPE=
// sourcecode.cpp.objcpp), so every FFmpeg include has to be wrapped
// explicitly at the call site or we get C++ name mangling on the av_*
// references and the linker blows up.

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavcodec/bsf.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/dict.h>
#include <libavutil/error.h>
#include <libavutil/mastering_display_metadata.h>
#include <libavutil/pixdesc.h>
}

#import <CoreGraphics/CoreGraphics.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <MobileCoreServices/UTCoreTypes.h>
#import <VideoToolbox/VideoToolbox.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <dispatch/dispatch.h>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <os/log.h>
#include <stdlib.h>
#include <string.h>
#include <thread>
#include <vector>

static os_log_t jf_ffmpeg_log(void) {
    static os_log_t log;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        log = os_log_create("com.jellyfuse.app", "FFmpegBridge");
    });
    return log;
}

// avformat_network_init is thread-safe but must run once before any
// HTTPS/HTTP open call. Guard with dispatch_once so it's a no-op on
// repeat loads.
static void jf_ffmpeg_init_once(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        avformat_network_init();
    });
}

extern "C" const char *jf_ffmpeg_version_info(void) {
    return av_version_info();
}

static bool is_bitmap_sub_codec(enum AVCodecID id) {
    switch (id) {
    case AV_CODEC_ID_HDMV_PGS_SUBTITLE:
    case AV_CODEC_ID_DVD_SUBTITLE:
    case AV_CODEC_ID_DVB_SUBTITLE:
        return true;
    default:
        return false;
    }
}

// Streaming PAL8→RGBA for a single subtitle rect. Writes into a caller-
// owned buffer sized w*h*4. Byte order: R, G, B, A — matches Skia's
// kRGBA_8888_SkColorType which is what the JS overlay consumes.
//
// FFmpeg hands us `rect->data[1]` as a 256-entry uint32_t palette in
// AV_PIX_FMT_RGB32 layout. On little-endian (iOS/ARM) that's BGRA bytes
// in memory, so reading as uint32_t gives us 0xAARRGGBB — the shifts
// below extract the four channels regardless of endianness.
static void rect_to_rgba(const AVSubtitleRect *rect, uint8_t *rgba) {
    const int w = rect->w;
    const int h = rect->h;
    const int stride = rect->linesize[0];
    const uint32_t *palette = (const uint32_t *)rect->data[1];
    const uint8_t *indices = rect->data[0];

    for (int y = 0; y < h; y++) {
        const uint8_t *srcRow = indices + y * stride;
        uint8_t *dstRow = rgba + (size_t)y * (size_t)w * 4;
        for (int x = 0; x < w; x++) {
            uint32_t argb = palette[srcRow[x]];
            uint8_t *p = dstRow + (size_t)x * 4;
            p[0] = (argb >> 16) & 0xff; // R
            p[1] = (argb >>  8) & 0xff; // G
            p[2] = (argb >>  0) & 0xff; // B
            p[3] = (argb >> 24) & 0xff; // A
        }
    }
}

// ─── Streaming decoder ──────────────────────────────────────────────
// Opaque context the Swift side owns. Swift holds a raw pointer and
// invokes the C functions below; the context is single-threaded — the
// caller must not poke it from more than one queue at a time.

struct jf_bitmap_sub_ctx {
    AVFormatContext *fmt;
    AVCodecContext *cctx;
    int streamIndex;
    AVRational timeBase;
    AVPacket *pkt;
    std::atomic<int> cancel;
};

// Interrupt callback — returns non-zero when avformat should abort the
// current blocking op. Lets `close` unblock a `decode_next` that's
// parked inside av_read_frame waiting on HTTPS bytes.
static int jf_bitmap_sub_interrupt(void *opaque) {
    auto *ctx = (struct jf_bitmap_sub_ctx *)opaque;
    return ctx && ctx->cancel.load() ? 1 : 0;
}

// `requested_stream_index` selects which subtitle stream to decode:
//   >= 0  → open exactly that avformat stream; fail if it isn't a bitmap
//           sub. Used when mpv's sid observer identifies the user's
//           selection by `ff-index`.
//   <  0  → auto-pick the first bitmap sub stream (legacy callers / no
//           mpv mapping available yet).
//
// `user_agent` pins avformat's HTTP UA so the sidecar fetch hits the
// same server session as the main mpv open. Pass whatever libmpv is
// using (`options.userAgent` → mpv's `user-agent` property); nullptr
// keeps avformat's default, which is only safe when the server is
// UA-agnostic.
extern "C" struct jf_bitmap_sub_ctx *jf_bitmap_sub_open(const char *url,
                                                         double start_seconds,
                                                         int requested_stream_index,
                                                         const char *user_agent) {
    if (!url) return nullptr;
    jf_ffmpeg_init_once();

    AVFormatContext *fmt = nullptr;
    AVDictionary *opts = nullptr;
    av_dict_set(&opts, "rw_timeout", "15000000", 0);
    av_dict_set(&opts, "user_agent",
                user_agent ? user_agent : "Jellyfuse/1.0 libavformat", 0);

    int rc = avformat_open_input(&fmt, url, nullptr, &opts);
    av_dict_free(&opts);
    if (rc < 0) {
        char err[AV_ERROR_MAX_STRING_SIZE] = {0};
        av_strerror(rc, err, sizeof(err));
        os_log_error(jf_ffmpeg_log(), "open: avformat_open_input failed (%{public}s)", err);
        return nullptr;
    }

    rc = avformat_find_stream_info(fmt, nullptr);
    if (rc < 0) {
        os_log_error(jf_ffmpeg_log(), "open: find_stream_info failed");
        avformat_close_input(&fmt);
        return nullptr;
    }

    int streamIndex = -1;
    if (requested_stream_index >= 0) {
        if (requested_stream_index < (int)fmt->nb_streams) {
            AVStream *st = fmt->streams[requested_stream_index];
            if (st->codecpar->codec_type == AVMEDIA_TYPE_SUBTITLE &&
                is_bitmap_sub_codec(st->codecpar->codec_id)) {
                streamIndex = requested_stream_index;
            }
        }
        if (streamIndex < 0) {
            os_log_error(jf_ffmpeg_log(),
                         "open: requested stream #%d is not a bitmap sub",
                         requested_stream_index);
            avformat_close_input(&fmt);
            return nullptr;
        }
    } else {
        for (unsigned i = 0; i < fmt->nb_streams; i++) {
            AVStream *st = fmt->streams[i];
            if (st->codecpar->codec_type != AVMEDIA_TYPE_SUBTITLE) continue;
            if (is_bitmap_sub_codec(st->codecpar->codec_id)) {
                streamIndex = (int)i;
                break;
            }
        }
        if (streamIndex < 0) {
            os_log(jf_ffmpeg_log(), "open: no bitmap sub stream");
            avformat_close_input(&fmt);
            return nullptr;
        }
    }

    for (unsigned i = 0; i < fmt->nb_streams; i++) {
        fmt->streams[i]->discard = (int(i) == streamIndex) ? AVDISCARD_DEFAULT : AVDISCARD_ALL;
    }

    AVStream *st = fmt->streams[streamIndex];
    const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
    if (!codec) {
        os_log_error(jf_ffmpeg_log(), "open: no decoder for codec %d",
                     (int)st->codecpar->codec_id);
        avformat_close_input(&fmt);
        return nullptr;
    }

    AVCodecContext *cctx = avcodec_alloc_context3(codec);
    if (!cctx) {
        avformat_close_input(&fmt);
        return nullptr;
    }
    if (avcodec_parameters_to_context(cctx, st->codecpar) < 0 ||
        avcodec_open2(cctx, codec, nullptr) < 0) {
        avcodec_free_context(&cctx);
        avformat_close_input(&fmt);
        return nullptr;
    }

    if (start_seconds > 0) {
        int64_t seekTs = (int64_t)(start_seconds / av_q2d(st->time_base));
        (void)av_seek_frame(fmt, streamIndex, seekTs, AVSEEK_FLAG_BACKWARD);
    }

    auto *ctx = new jf_bitmap_sub_ctx();
    ctx->fmt = fmt;
    ctx->cctx = cctx;
    ctx->streamIndex = streamIndex;
    ctx->timeBase = st->time_base;
    ctx->pkt = av_packet_alloc();
    ctx->cancel.store(0);
    fmt->interrupt_callback.callback = jf_bitmap_sub_interrupt;
    fmt->interrupt_callback.opaque = ctx;

    AVDictionaryEntry *lang = av_dict_get(st->metadata, "language", nullptr, 0);
    os_log(jf_ffmpeg_log(),
           "open: stream #%d codec=%{public}s lang=%{public}s start=%.2fs",
           streamIndex, codec->name, lang ? lang->value : "?", start_seconds);
    return ctx;
}

// Reads the next subtitle event off the wire. Blocking — caller must
// invoke from a background queue.
//
// Returns:
//   0  = event decoded; `*out_rgba` points to malloc'd buffer (NULL for
//        clear events where `*out_num_rects == 0`). Caller frees via
//        `jf_bitmap_sub_free_rgba`.
//   1  = EOF
//  <0  = error
//
// Multi-rect events (DVB / DVD sometimes emit two) are collapsed to the
// first rect — logged so we can tell if a track needs real multi-rect
// support later. PGS always ships a single rect per event.
extern "C" int jf_bitmap_sub_decode_next(struct jf_bitmap_sub_ctx *ctx,
                                          double *out_pts_seconds,
                                          double *out_duration_seconds,
                                          int *out_num_rects,
                                          int *out_x, int *out_y,
                                          int *out_width, int *out_height,
                                          uint8_t **out_rgba) {
    if (!ctx || !ctx->fmt || !ctx->cctx || !ctx->pkt) return -1;

    *out_pts_seconds = 0;
    *out_duration_seconds = 0;
    *out_num_rects = 0;
    *out_x = 0;
    *out_y = 0;
    *out_width = 0;
    *out_height = 0;
    *out_rgba = nullptr;

    while (true) {
        int rc = av_read_frame(ctx->fmt, ctx->pkt);
        if (rc == AVERROR_EOF) return 1;
        if (rc < 0) {
            char err[AV_ERROR_MAX_STRING_SIZE] = {0};
            av_strerror(rc, err, sizeof(err));
            os_log_error(jf_ffmpeg_log(), "decode: read_frame failed (%{public}s)", err);
            return -1;
        }
        if (ctx->pkt->stream_index != ctx->streamIndex) {
            av_packet_unref(ctx->pkt);
            continue;
        }

        AVSubtitle sub;
        int got = 0;
        rc = avcodec_decode_subtitle2(ctx->cctx, &sub, &got, ctx->pkt);
        if (rc < 0) {
            os_log_error(jf_ffmpeg_log(), "decode: decode_subtitle2 failed");
            av_packet_unref(ctx->pkt);
            continue;
        }
        if (!got) {
            av_packet_unref(ctx->pkt);
            continue;
        }

        double pts_seconds = 0;
        if (ctx->pkt->pts != AV_NOPTS_VALUE) {
            pts_seconds = (double)ctx->pkt->pts * av_q2d(ctx->timeBase);
        }
        double start_ms = (double)sub.start_display_time;
        double end_ms = (double)sub.end_display_time;
        double duration_s =
            (end_ms > start_ms && end_ms != (double)UINT32_MAX) ? (end_ms - start_ms) / 1000.0
                                                                : 0.0;

        *out_pts_seconds = pts_seconds + start_ms / 1000.0;
        *out_duration_seconds = duration_s;
        *out_num_rects = (int)sub.num_rects;

        if (sub.num_rects > 0) {
            if (sub.num_rects > 1) {
                os_log(jf_ffmpeg_log(),
                       "decode: event has %u rects, using first only",
                       sub.num_rects);
            }
            AVSubtitleRect *rect = sub.rects[0];
            if (rect->w > 0 && rect->h > 0 && rect->data[0] && rect->data[1]) {
                size_t bytes = (size_t)rect->w * (size_t)rect->h * 4;
                uint8_t *rgba = (uint8_t *)malloc(bytes);
                if (rgba) {
                    rect_to_rgba(rect, rgba);
                    *out_x = rect->x;
                    *out_y = rect->y;
                    *out_width = rect->w;
                    *out_height = rect->h;
                    *out_rgba = rgba;
                }
            }
        }

        avsubtitle_free(&sub);
        av_packet_unref(ctx->pkt);
        return 0;
    }
}

// Composition dimensions the subtitle stream was authored against —
// the coordinate system for every rect's x/y/w/h. PGS declares these
// in its presentation composition segment; FFmpeg copies them onto the
// codec context during `avcodec_parameters_to_context`. Used by the
// overlay to letterbox rects into the on-screen video rect at the
// correct resolution (1920×1080 for HD Blu-ray, 3840×2160 for 4K).
// Writes 0 when the codec didn't publish a size.
extern "C" void jf_bitmap_sub_source_size(struct jf_bitmap_sub_ctx *ctx,
                                          int *out_width,
                                          int *out_height) {
    if (!out_width || !out_height) return;
    *out_width = 0;
    *out_height = 0;
    if (!ctx || !ctx->cctx) return;
    if (ctx->cctx->width > 0 && ctx->cctx->height > 0) {
        *out_width = ctx->cctx->width;
        *out_height = ctx->cctx->height;
    }
}

extern "C" int jf_bitmap_sub_seek(struct jf_bitmap_sub_ctx *ctx, double seconds) {
    if (!ctx || !ctx->fmt || !ctx->cctx) return -1;
    int64_t seekTs = (int64_t)(seconds / av_q2d(ctx->timeBase));
    int rc = av_seek_frame(ctx->fmt, ctx->streamIndex, seekTs, AVSEEK_FLAG_BACKWARD);
    if (rc < 0) {
        char err[AV_ERROR_MAX_STRING_SIZE] = {0};
        av_strerror(rc, err, sizeof(err));
        os_log_error(jf_ffmpeg_log(), "seek: av_seek_frame failed (%{public}s)", err);
        return -1;
    }
    // Clear any state the bitmap decoder may have carried across the seek
    // (PGS in particular keeps a composition buffer).
    avcodec_flush_buffers(ctx->cctx);
    return 0;
}

extern "C" void jf_bitmap_sub_free_rgba(uint8_t *rgba) {
    if (rgba) free(rgba);
}

extern "C" void jf_bitmap_sub_cancel(struct jf_bitmap_sub_ctx *ctx) {
    if (!ctx) return;
    ctx->cancel.store(1);
}

// Query the cancel flag so the Swift-side pacing loop can bail out
// when a seek/teardown was requested while it was waiting for mpv's
// playback time to catch up to the next sub's pts.
extern "C" int jf_bitmap_sub_is_cancelled(struct jf_bitmap_sub_ctx *ctx) {
    if (!ctx) return 1;
    return ctx->cancel.load() ? 1 : 0;
}

extern "C" void jf_bitmap_sub_close(struct jf_bitmap_sub_ctx *ctx) {
    if (!ctx) return;
    ctx->cancel.store(1);
    if (ctx->pkt) av_packet_free(&ctx->pkt);
    if (ctx->cctx) avcodec_free_context(&ctx->cctx);
    if (ctx->fmt) avformat_close_input(&ctx->fmt);
    delete ctx;
}

// ═══════════════════════════════════════════════════════════════════════
//   Phase 2 video sidecar — see docs/native-video-pipeline-phase-2.md
// ═══════════════════════════════════════════════════════════════════════
//
// Mirrors the bitmap-sub shim above: opaque handle + pure-C entry points
// bound via Swift `@_silgen_name`. One context per player session.
//
// Pipeline shape (Commit B):
//   avformat → packets (HVCC/AVCC length-prefixed, unmodified) →
//   CMSampleBuffer (with codec-specific format description built from
//   extradata) → VTDecompressionSessionDecodeFrame (async) →
//   VT callback pushes CVPixelBuffer + PTS into a PTS-sorted bounded
//   output queue → Swift consumer pops via jf_video_decode_next.
//
// Reorder: HEVC/H.264 decode order ≠ display order (B-frames). The
// VT callback fires in decode order; we insert into the queue sorted
// by PTS and only emit once `reorder_window` frames are buffered, so
// the consumer sees monotonic PTS. `reorder_window = 4` covers the
// HEVC max-reorder-depth seen in practice.
//
// Threading:
//   pump_thread   — reads packets + feeds VT. Backpressured by queue.
//   VT callback   — arbitrary VT worker threads. Protected by mutex.
//   consumer      — Swift, calls jf_video_decode_next with timeout.

static os_log_t jf_video_log(void) {
    static os_log_t log;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        log = os_log_create("com.jellyfuse.app", "VideoSidecar");
    });
    return log;
}

struct DecodedFrame {
    CVPixelBufferRef buffer; // retained
    double pts_seconds;
    bool is_keyframe;
};

struct jf_video_ctx {
    // Demux
    AVFormatContext *fmt = nullptr;
    AVCodecContext *cctx = nullptr;
    int streamIndex = -1;
    AVRational timeBase{0, 1};
    std::atomic<int> cancel{0};

    // VT decode
    CMVideoFormatDescriptionRef formatDesc = nullptr;
    VTDecompressionSessionRef vtSession = nullptr;
    OSType pixelFormat = 0;
    // True when the source bitstream is Annex-B (MPEGTS / HLS /
    // raw H.264 or HEVC). Decides whether every outbound packet needs
    // start-code → length-prefix rewriting before VT sees it.
    bool annexB = false;

    // Pump thread
    std::thread pumpThread;
    std::atomic<bool> stopFlag{false};
    std::atomic<bool> pumpEof{false};

    // Output queue (sorted by PTS)
    std::deque<DecodedFrame> outQueue;
    std::mutex queueMutex;
    std::condition_variable queueCv;
    size_t queueCap = 6;
    size_t reorderWindow = 4;

    // Seek (consumer → pump)
    std::mutex seekMutex;
    std::optional<double> pendingSeek;
};

static int jf_video_interrupt(void *opaque) {
    auto *ctx = (struct jf_video_ctx *)opaque;
    return ctx && ctx->cancel.load() ? 1 : 0;
}

// ── color / HDR extension mapping ───────────────────────────────────

static void setCF(CFMutableDictionaryRef d, CFStringRef k, CFTypeRef v) {
    if (v) CFDictionarySetValue(d, k, v);
}

static CFStringRef colorPrimariesToCF(int p) {
    switch (p) {
    case AVCOL_PRI_BT709:
        return kCMFormatDescriptionColorPrimaries_ITU_R_709_2;
    case AVCOL_PRI_SMPTE170M:
    case AVCOL_PRI_BT470BG:
        return kCMFormatDescriptionColorPrimaries_EBU_3213;
    case AVCOL_PRI_BT2020:
        return kCMFormatDescriptionColorPrimaries_ITU_R_2020;
    case AVCOL_PRI_SMPTE432:
        return kCMFormatDescriptionColorPrimaries_P3_D65;
    default:
        return nullptr;
    }
}

static CFStringRef transferToCF(int t) {
    switch (t) {
    case AVCOL_TRC_BT709:
    case AVCOL_TRC_BT2020_10:
    case AVCOL_TRC_BT2020_12:
        return kCMFormatDescriptionTransferFunction_ITU_R_709_2;
    case AVCOL_TRC_SMPTE2084:
        return kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ;
    case AVCOL_TRC_ARIB_STD_B67:
        return kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG;
    case AVCOL_TRC_LINEAR:
        return kCMFormatDescriptionTransferFunction_Linear;
    default:
        return nullptr;
    }
}

static CFStringRef matrixToCF(int m) {
    switch (m) {
    case AVCOL_SPC_BT709:
        return kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2;
    case AVCOL_SPC_BT470BG:
    case AVCOL_SPC_SMPTE170M:
        return kCMFormatDescriptionYCbCrMatrix_ITU_R_601_4;
    case AVCOL_SPC_BT2020_NCL:
    case AVCOL_SPC_BT2020_CL:
        return kCMFormatDescriptionYCbCrMatrix_ITU_R_2020;
    default:
        return nullptr;
    }
}

// Attach color primaries / transfer / matrix / range + HDR mastering +
// CLL side data to the CMFormatDescription extensions dictionary. These
// flow through the decoded CVPixelBuffer and drive AVSampleBufferDisplay
// Layer's HDR handling.
static void attachColorExtensions(AVStream *st, CFMutableDictionaryRef ext) {
    AVCodecParameters *par = st->codecpar;

    setCF(ext, kCMFormatDescriptionExtension_ColorPrimaries,
          colorPrimariesToCF(par->color_primaries));
    setCF(ext, kCMFormatDescriptionExtension_TransferFunction,
          transferToCF(par->color_trc));
    setCF(ext, kCMFormatDescriptionExtension_YCbCrMatrix,
          matrixToCF(par->color_space));
    if (par->color_range == AVCOL_RANGE_JPEG) {
        CFDictionarySetValue(ext, kCMFormatDescriptionExtension_FullRangeVideo,
                             kCFBooleanTrue);
    }
}

// ── Annex-B helpers ─────────────────────────────────────────────────
//
// VT only ingests length-prefixed (AVCC/HVCC) bitstreams. libavformat
// delivers packets from MPEGTS / HLS / raw H.264 / raw HEVC in
// Annex-B form (NALs separated by 0x00000001 / 0x000001 start codes)
// with extradata either empty or Annex-B-formatted. Before we hand
// data to VT we have to (a) rewrite every NAL with a 4-byte big-endian
// length prefix and (b) build a proper avcC / hvcC format description
// derived from the SPS/PPS/VPS NALs we extract from extradata.

// Detect an Annex-B start code at `p`. Writes the code length (3 or 4)
// to `*scLen` and returns true if found.
static bool annexBStartCode(const uint8_t *p, int len, int *scLen) {
    if (len >= 4 && p[0] == 0 && p[1] == 0 && p[2] == 0 && p[3] == 1) {
        *scLen = 4;
        return true;
    }
    if (len >= 3 && p[0] == 0 && p[1] == 0 && p[2] == 1) {
        *scLen = 3;
        return true;
    }
    return false;
}

// Walk Annex-B data and invoke `cb(nalPayload, nalSize)` for each NAL
// (start code stripped). Handles leading data before the first start
// code by ignoring it.
static void forEachAnnexBNal(const uint8_t *data, int size,
                              const std::function<void(const uint8_t *, int)> &cb) {
    int i = 0;
    while (i < size) {
        int sc = 0;
        if (!annexBStartCode(data + i, size - i, &sc)) {
            i++;
            continue;
        }
        int nalStart = i + sc;
        int j = nalStart;
        while (j < size) {
            int nextSc = 0;
            if (annexBStartCode(data + j, size - j, &nextSc)) break;
            j++;
        }
        int nalSize = j - nalStart;
        if (nalSize > 0) cb(data + nalStart, nalSize);
        i = j;
    }
}

// Convert an Annex-B buffer to length-prefixed (AVCC) bytes. Allocates
// the output via `CFAllocatorDefault` so it can be handed directly to
// `CMBlockBufferCreateWithMemoryBlock` with the same allocator as the
// dataDeallocator. Returns false + leaves outputs untouched if no NALs
// were found.
static bool annexBToLengthPrefixed(const uint8_t *src, int srcSize,
                                    uint8_t **outData, size_t *outSize) {
    size_t total = 0;
    forEachAnnexBNal(src, srcSize, [&](const uint8_t *, int nalSize) {
        total += 4 + (size_t)nalSize;
    });
    if (total == 0) return false;
    uint8_t *dst = (uint8_t *)CFAllocatorAllocate(kCFAllocatorDefault, total, 0);
    if (!dst) return false;
    size_t off = 0;
    forEachAnnexBNal(src, srcSize, [&](const uint8_t *nal, int nalSize) {
        dst[off + 0] = (uint8_t)((nalSize >> 24) & 0xFF);
        dst[off + 1] = (uint8_t)((nalSize >> 16) & 0xFF);
        dst[off + 2] = (uint8_t)((nalSize >>  8) & 0xFF);
        dst[off + 3] = (uint8_t)( nalSize        & 0xFF);
        memcpy(dst + off + 4, nal, (size_t)nalSize);
        off += 4 + (size_t)nalSize;
    });
    *outData = dst;
    *outSize = total;
    return true;
}

// Build an `avcC` atom payload from Annex-B extradata. Extracts the
// first SPS (NAL type 7) for profile/level fields. Returns a CFData
// the caller owns.
static CFDataRef buildAvcCFromAnnexB(const uint8_t *extra, int extraSize) {
    std::vector<std::vector<uint8_t>> spsList, ppsList;
    forEachAnnexBNal(extra, extraSize, [&](const uint8_t *nal, int size) {
        if (size < 1) return;
        uint8_t nalType = nal[0] & 0x1F;
        if (nalType == 7)
            spsList.emplace_back(nal, nal + size);
        else if (nalType == 8)
            ppsList.emplace_back(nal, nal + size);
    });
    if (spsList.empty() || ppsList.empty()) return nullptr;
    const auto &sps = spsList[0];
    if (sps.size() < 4) return nullptr;

    CFMutableDataRef out = CFDataCreateMutable(kCFAllocatorDefault, 0);
    const uint8_t header[] = {
        0x01,          // configurationVersion
        sps[1],        // profile_idc
        sps[2],        // profile_compatibility
        sps[3],        // level_idc
        0xFF,          // 6 reserved bits | lengthSizeMinusOne = 3
        (uint8_t)(0xE0 | (spsList.size() & 0x1F)),
    };
    CFDataAppendBytes(out, header, sizeof(header));
    for (const auto &sp : spsList) {
        const uint8_t len[2] = {
            (uint8_t)((sp.size() >> 8) & 0xFF),
            (uint8_t)( sp.size()        & 0xFF),
        };
        CFDataAppendBytes(out, len, 2);
        CFDataAppendBytes(out, sp.data(), (CFIndex)sp.size());
    }
    const uint8_t numPps = (uint8_t)ppsList.size();
    CFDataAppendBytes(out, &numPps, 1);
    for (const auto &pp : ppsList) {
        const uint8_t len[2] = {
            (uint8_t)((pp.size() >> 8) & 0xFF),
            (uint8_t)( pp.size()        & 0xFF),
        };
        CFDataAppendBytes(out, len, 2);
        CFDataAppendBytes(out, pp.data(), (CFIndex)pp.size());
    }
    return out;
}

// ── VT session ──────────────────────────────────────────────────────

// Build the CMFormatDescription for the stream. Uses the codec's
// extradata packed as an HVCC / AVCC atom under
// `SampleDescriptionExtensionAtoms`, matching the mp4 sample description
// layout so VT's built-in parser handles SPS/PPS/VPS extraction for us.
// For Annex-B sources (MPEGTS / HLS transcode / raw H.264 or HEVC)
// we synthesise the atom from SPS/PPS/VPS NALs.
// Returns `nullptr` on unsupported codec or missing extradata.
static CMVideoFormatDescriptionRef buildFormatDescription(AVStream *st, bool annexB) {
    AVCodecParameters *par = st->codecpar;
    if (!par->extradata || par->extradata_size <= 0) {
        os_log_error(jf_video_log(), "buildFormatDescription: missing extradata");
        return nullptr;
    }

    CMVideoCodecType codecType = 0;
    CFStringRef atomKey = nullptr;
    switch (par->codec_id) {
    case AV_CODEC_ID_HEVC:
        codecType = kCMVideoCodecType_HEVC;
        atomKey = CFSTR("hvcC");
        break;
    case AV_CODEC_ID_H264:
        codecType = kCMVideoCodecType_H264;
        atomKey = CFSTR("avcC");
        break;
    default:
        os_log_error(jf_video_log(),
                     "buildFormatDescription: unsupported codec %d",
                     (int)par->codec_id);
        return nullptr;
    }

    CFMutableDictionaryRef extensions = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    attachColorExtensions(st, extensions);

    // HEVC Annex-B: let CoreMedia synthesise the hvcC atom from
    // VPS/SPS/PPS NALs. Doing it by hand requires parsing the SPS
    // profile_tier_level, which is painful; the CM helper accepts raw
    // NALs and produces a spec-correct hvcC.
    if (annexB && par->codec_id == AV_CODEC_ID_HEVC) {
        std::vector<std::vector<uint8_t>> vpsList, spsList, ppsList;
        forEachAnnexBNal(par->extradata, par->extradata_size,
                         [&](const uint8_t *nal, int size) {
                             if (size < 1) return;
                             uint8_t nalType = (nal[0] >> 1) & 0x3F;
                             if (nalType == 32) vpsList.emplace_back(nal, nal + size);
                             else if (nalType == 33) spsList.emplace_back(nal, nal + size);
                             else if (nalType == 34) ppsList.emplace_back(nal, nal + size);
                         });
        if (spsList.empty() || ppsList.empty()) {
            os_log_error(jf_video_log(),
                         "buildFormatDescription: Annex-B HEVC missing SPS/PPS "
                         "in extradata (size=%d)",
                         par->extradata_size);
            CFRelease(extensions);
            return nullptr;
        }
        std::vector<const uint8_t *> ptrs;
        std::vector<size_t> sizes;
        for (const auto &v : vpsList) { ptrs.push_back(v.data()); sizes.push_back(v.size()); }
        for (const auto &s : spsList) { ptrs.push_back(s.data()); sizes.push_back(s.size()); }
        for (const auto &p : ppsList) { ptrs.push_back(p.data()); sizes.push_back(p.size()); }

        CMVideoFormatDescriptionRef fd = nullptr;
        OSStatus rc = CMVideoFormatDescriptionCreateFromHEVCParameterSets(
            kCFAllocatorDefault, ptrs.size(), ptrs.data(), sizes.data(),
            /*NALUnitHeaderLength=*/4, extensions, &fd);
        CFRelease(extensions);
        if (rc != noErr) {
            os_log_error(jf_video_log(),
                         "buildFormatDescription: HEVC FromParameterSets rc=%d",
                         (int)rc);
            return nullptr;
        }
        return fd;
    }

    CFMutableDictionaryRef atoms = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);

    CFDataRef atomData = nullptr;
    if (annexB) {
        // H.264 Annex-B: synthesise avcC from extracted SPS/PPS.
        atomData = buildAvcCFromAnnexB(par->extradata, par->extradata_size);
        if (!atomData) {
            os_log_error(jf_video_log(),
                         "buildFormatDescription: Annex-B H.264 missing SPS/PPS "
                         "in extradata (size=%d)",
                         par->extradata_size);
            CFRelease(atoms);
            CFRelease(extensions);
            return nullptr;
        }
    } else {
        // Source already provides a length-prefixed (AVCC/HVCC) descriptor.
        atomData = CFDataCreate(kCFAllocatorDefault, par->extradata,
                                 par->extradata_size);
    }
    CFDictionarySetValue(atoms, atomKey, atomData);
    CFRelease(atomData);

    CFDictionarySetValue(extensions,
                          kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms,
                          atoms);
    CFRelease(atoms);

    CMVideoFormatDescriptionRef fd = nullptr;
    OSStatus rc = CMVideoFormatDescriptionCreate(
        kCFAllocatorDefault, codecType, par->width, par->height,
        extensions, &fd);
    CFRelease(extensions);

    if (rc != noErr) {
        os_log_error(jf_video_log(),
                     "buildFormatDescription: CMVideoFormatDescriptionCreate rc=%d",
                     (int)rc);
        return nullptr;
    }
    return fd;
}

static void vtDecodeCallback(void *refCon,
                              void *sourceFrameRefCon,
                              OSStatus status,
                              VTDecodeInfoFlags infoFlags,
                              CVImageBufferRef imageBuffer,
                              CMTime pts,
                              CMTime duration);

static bool createVtSession(jf_video_ctx *ctx, int bitsPerSample) {
    ctx->pixelFormat = (bitsPerSample > 8)
        ? kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange
        : kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;

    CFMutableDictionaryRef destAttrs = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);

    CFNumberRef pfNum = CFNumberCreate(kCFAllocatorDefault,
                                        kCFNumberSInt32Type,
                                        &ctx->pixelFormat);
    CFDictionarySetValue(destAttrs, kCVPixelBufferPixelFormatTypeKey, pfNum);
    CFRelease(pfNum);

    CFMutableDictionaryRef ioSurfaceProps = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(destAttrs, kCVPixelBufferIOSurfacePropertiesKey,
                          ioSurfaceProps);
    CFRelease(ioSurfaceProps);

    CFDictionarySetValue(destAttrs, kCVPixelBufferMetalCompatibilityKey,
                          kCFBooleanTrue);

    VTDecompressionOutputCallbackRecord cb;
    cb.decompressionOutputCallback = vtDecodeCallback;
    cb.decompressionOutputRefCon = ctx;

    OSStatus rc = VTDecompressionSessionCreate(
        kCFAllocatorDefault, ctx->formatDesc,
        /*videoDecoderSpecification=*/nullptr,
        destAttrs, &cb, &ctx->vtSession);
    CFRelease(destAttrs);

    if (rc != noErr) {
        os_log_error(jf_video_log(),
                     "createVtSession: VTDecompressionSessionCreate rc=%d",
                     (int)rc);
        return false;
    }

    VTSessionSetProperty(ctx->vtSession,
                          kVTDecompressionPropertyKey_RealTime,
                          kCFBooleanTrue);

    os_log(jf_video_log(),
           "createVtSession: ok pixelFormat=%c%c%c%c bits=%d",
           (char)(ctx->pixelFormat >> 24), (char)(ctx->pixelFormat >> 16),
           (char)(ctx->pixelFormat >> 8),  (char)ctx->pixelFormat,
           bitsPerSample);
    return true;
}

// ── packet → CMSampleBuffer ─────────────────────────────────────────

static CMSampleBufferRef buildSampleBuffer(jf_video_ctx *ctx, AVPacket *pkt) {
    // VT async may hold past av_packet_unref — always copy. For
    // Annex-B sources we also rewrite start codes to 4-byte length
    // prefixes during the copy; for AVCC sources we just memcpy.
    uint8_t *data = nullptr;
    size_t dataSize = 0;
    if (ctx->annexB) {
        if (!annexBToLengthPrefixed(pkt->data, pkt->size, &data, &dataSize)) {
            return nullptr;
        }
    } else {
        data = (uint8_t *)CFAllocatorAllocate(kCFAllocatorDefault, pkt->size, 0);
        if (!data) return nullptr;
        memcpy(data, pkt->data, (size_t)pkt->size);
        dataSize = (size_t)pkt->size;
    }

    CMBlockBufferRef blockBuffer = nullptr;
    OSStatus rc = CMBlockBufferCreateWithMemoryBlock(
        kCFAllocatorDefault, data, dataSize,
        kCFAllocatorDefault, /*blockSource=*/nullptr,
        0, dataSize, 0, &blockBuffer);
    if (rc != noErr) {
        CFAllocatorDeallocate(kCFAllocatorDefault, data);
        return nullptr;
    }

    CMSampleTimingInfo timing;
    timing.duration = pkt->duration > 0
        ? CMTimeMake(pkt->duration * ctx->timeBase.num, ctx->timeBase.den)
        : kCMTimeInvalid;
    timing.presentationTimeStamp = (pkt->pts != AV_NOPTS_VALUE)
        ? CMTimeMake(pkt->pts * ctx->timeBase.num, ctx->timeBase.den)
        : kCMTimeInvalid;
    timing.decodeTimeStamp = (pkt->dts != AV_NOPTS_VALUE)
        ? CMTimeMake(pkt->dts * ctx->timeBase.num, ctx->timeBase.den)
        : kCMTimeInvalid;

    size_t sampleSize = dataSize;
    CMSampleBufferRef sbuf = nullptr;
    rc = CMSampleBufferCreate(
        kCFAllocatorDefault, blockBuffer, /*dataReady=*/true,
        /*makeDataReadyCallback=*/nullptr, /*makeDataReadyRefcon=*/nullptr,
        ctx->formatDesc,
        /*numSamples=*/1, /*numSampleTimingEntries=*/1, &timing,
        /*numSampleSizeEntries=*/1, &sampleSize,
        &sbuf);
    CFRelease(blockBuffer);
    if (rc != noErr) return nullptr;

    if (pkt->flags & AV_PKT_FLAG_KEY) {
        CFArrayRef attachmentsArray =
            CMSampleBufferGetSampleAttachmentsArray(sbuf, /*create=*/true);
        if (attachmentsArray && CFArrayGetCount(attachmentsArray) > 0) {
            CFMutableDictionaryRef dict = (CFMutableDictionaryRef)
                CFArrayGetValueAtIndex(attachmentsArray, 0);
            CFDictionarySetValue(dict, kCMSampleAttachmentKey_NotSync,
                                  kCFBooleanFalse);
        }
    }
    return sbuf;
}

// ── queue ops (caller holds queueMutex) ─────────────────────────────

static void insertSorted(jf_video_ctx *ctx, const DecodedFrame &frame) {
    auto it = std::upper_bound(
        ctx->outQueue.begin(), ctx->outQueue.end(), frame,
        [](const DecodedFrame &a, const DecodedFrame &b) {
            return a.pts_seconds < b.pts_seconds;
        });
    ctx->outQueue.insert(it, frame);
}

static void drainQueueLocked(jf_video_ctx *ctx) {
    for (auto &f : ctx->outQueue) {
        if (f.buffer) CFRelease(f.buffer);
    }
    ctx->outQueue.clear();
}

// ── VT callback ─────────────────────────────────────────────────────

static void vtDecodeCallback(void *refCon,
                              void *sourceFrameRefCon,
                              OSStatus status,
                              VTDecodeInfoFlags infoFlags,
                              CVImageBufferRef imageBuffer,
                              CMTime pts,
                              CMTime duration) {
    (void)duration;
    auto *ctx = (jf_video_ctx *)refCon;
    if (!ctx) return;

    if (status != noErr || !imageBuffer) {
        if (status != noErr) {
            os_log_error(jf_video_log(),
                         "vtDecodeCallback: status=%d dropped=%d",
                         (int)status,
                         (infoFlags & kVTDecodeInfo_FrameDropped) ? 1 : 0);
        }
        return;
    }

    DecodedFrame frame;
    frame.buffer = (CVPixelBufferRef)CFRetain(imageBuffer);
    frame.pts_seconds = CMTIME_IS_VALID(pts) ? CMTimeGetSeconds(pts) : 0.0;
    frame.is_keyframe = ((uintptr_t)sourceFrameRefCon & 1) != 0;

    std::unique_lock<std::mutex> lock(ctx->queueMutex);
    // Backpressure — wait until queue has room. The pump thread also
    // backpressures on av_read_frame via the same queue, but a late
    // callback can still hit the cap.
    ctx->queueCv.wait(lock, [&] {
        return ctx->outQueue.size() < ctx->queueCap || ctx->stopFlag.load();
    });
    if (ctx->stopFlag.load()) {
        CFRelease(frame.buffer);
        return;
    }
    insertSorted(ctx, frame);
    ctx->queueCv.notify_all();
}

// ── pump thread ─────────────────────────────────────────────────────

static void pumpThreadMain(jf_video_ctx *ctx) {
    AVPacket *pkt = av_packet_alloc();
    if (!pkt) return;

    while (!ctx->stopFlag.load()) {
        // Handle pending seek
        std::optional<double> seek;
        {
            std::lock_guard<std::mutex> sl(ctx->seekMutex);
            if (ctx->pendingSeek) {
                seek = ctx->pendingSeek;
                ctx->pendingSeek.reset();
            }
        }
        if (seek) {
            int64_t ts = (int64_t)(*seek / av_q2d(ctx->timeBase));
            int rc = av_seek_frame(ctx->fmt, ctx->streamIndex, ts,
                                    AVSEEK_FLAG_BACKWARD);
            if (rc < 0) {
                os_log_error(jf_video_log(), "pump: seek to %.2fs failed", *seek);
            }
            if (ctx->vtSession) {
                VTDecompressionSessionFinishDelayedFrames(ctx->vtSession);
                VTDecompressionSessionWaitForAsynchronousFrames(ctx->vtSession);
            }
            std::lock_guard<std::mutex> ql(ctx->queueMutex);
            drainQueueLocked(ctx);
            ctx->pumpEof.store(false);
            ctx->queueCv.notify_all();
        }

        int rc = av_read_frame(ctx->fmt, pkt);
        if (rc == AVERROR_EOF) {
            if (ctx->vtSession) {
                VTDecompressionSessionFinishDelayedFrames(ctx->vtSession);
                VTDecompressionSessionWaitForAsynchronousFrames(ctx->vtSession);
            }
            ctx->pumpEof.store(true);
            {
                std::lock_guard<std::mutex> ql(ctx->queueMutex);
                ctx->queueCv.notify_all();
            }
            break;
        }
        if (rc < 0) {
            if (ctx->cancel.load()) break;
            char err[AV_ERROR_MAX_STRING_SIZE] = {0};
            av_strerror(rc, err, sizeof(err));
            os_log_error(jf_video_log(), "pump: av_read_frame (%{public}s)", err);
            break;
        }
        if (pkt->stream_index != ctx->streamIndex) {
            av_packet_unref(pkt);
            continue;
        }

        // Backpressure on queue size to avoid runaway packet → VT submit.
        {
            std::unique_lock<std::mutex> lock(ctx->queueMutex);
            ctx->queueCv.wait(lock, [&] {
                return ctx->outQueue.size() < ctx->queueCap
                       || ctx->stopFlag.load();
            });
            if (ctx->stopFlag.load()) {
                av_packet_unref(pkt);
                break;
            }
        }

        const uintptr_t refcon = (pkt->flags & AV_PKT_FLAG_KEY) ? 1 : 0;
        CMSampleBufferRef sbuf = buildSampleBuffer(ctx, pkt);
        av_packet_unref(pkt);
        if (!sbuf) continue;

        VTDecodeFrameFlags flags = kVTDecodeFrame_EnableAsynchronousDecompression;
        VTDecodeInfoFlags info = 0;
        OSStatus vrc = VTDecompressionSessionDecodeFrame(
            ctx->vtSession, sbuf, flags, (void *)refcon, &info);
        CFRelease(sbuf);
        if (vrc != noErr) {
            os_log_error(jf_video_log(),
                         "pump: VTDecompressionSessionDecodeFrame rc=%d",
                         (int)vrc);
        }
    }

    av_packet_free(&pkt);
}

// ── open / close / cancel ───────────────────────────────────────────

extern "C" struct jf_video_ctx *jf_video_open(const char *url,
                                               double start_seconds,
                                               const char *user_agent) {
    if (!url) return nullptr;
    jf_ffmpeg_init_once();

    AVFormatContext *fmt = nullptr;
    AVDictionary *opts = nullptr;
    av_dict_set(&opts, "rw_timeout", "15000000", 0);
    av_dict_set(&opts, "user_agent",
                user_agent ? user_agent : "Jellyfuse/1.0 libavformat", 0);

    int rc = avformat_open_input(&fmt, url, nullptr, &opts);
    av_dict_free(&opts);
    if (rc < 0) {
        char err[AV_ERROR_MAX_STRING_SIZE] = {0};
        av_strerror(rc, err, sizeof(err));
        os_log_error(jf_video_log(), "open: avformat_open_input failed (%{public}s)", err);
        return nullptr;
    }

    rc = avformat_find_stream_info(fmt, nullptr);
    if (rc < 0) {
        os_log_error(jf_video_log(), "open: find_stream_info failed");
        avformat_close_input(&fmt);
        return nullptr;
    }

    int streamIndex = av_find_best_stream(fmt, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0);
    if (streamIndex < 0) {
        os_log_error(jf_video_log(), "open: no video stream");
        avformat_close_input(&fmt);
        return nullptr;
    }

    for (unsigned i = 0; i < fmt->nb_streams; i++) {
        fmt->streams[i]->discard = (int(i) == streamIndex) ? AVDISCARD_DEFAULT : AVDISCARD_ALL;
    }

    AVStream *st = fmt->streams[streamIndex];
    AVCodecContext *cctx = avcodec_alloc_context3(nullptr);
    if (!cctx) {
        avformat_close_input(&fmt);
        return nullptr;
    }
    if (avcodec_parameters_to_context(cctx, st->codecpar) < 0) {
        avcodec_free_context(&cctx);
        avformat_close_input(&fmt);
        return nullptr;
    }
    // No avcodec_open2 — we don't decode through FFmpeg. The codec
    // context is a typed bundle of parameters the Swift side reads.

    auto ctx = std::make_unique<jf_video_ctx>();
    ctx->fmt = fmt;
    ctx->cctx = cctx;
    ctx->streamIndex = streamIndex;
    ctx->timeBase = st->time_base;
    // AVCC/HVCC descriptors start with configurationVersion byte 0x01.
    // Anything else (empty, or leading 0x00 start code) is Annex-B —
    // which is what every MPEGTS / HLS / raw elementary stream delivers.
    ctx->annexB = !(st->codecpar->extradata_size > 0 &&
                    st->codecpar->extradata[0] == 0x01);
    fmt->interrupt_callback.callback = jf_video_interrupt;
    fmt->interrupt_callback.opaque = ctx.get();

    ctx->formatDesc = buildFormatDescription(st, ctx->annexB);
    if (!ctx->formatDesc) {
        avcodec_free_context(&ctx->cctx);
        avformat_close_input(&ctx->fmt);
        return nullptr;
    }

    int bits = (cctx->bits_per_raw_sample > 0) ? cctx->bits_per_raw_sample
             : (cctx->profile == AV_PROFILE_HEVC_MAIN_10 ||
                cctx->profile == AV_PROFILE_H264_HIGH_10 ||
                cctx->profile == AV_PROFILE_H264_HIGH_10_INTRA) ? 10 : 8;
    if (!createVtSession(ctx.get(), bits)) {
        CFRelease(ctx->formatDesc);
        avcodec_free_context(&ctx->cctx);
        avformat_close_input(&ctx->fmt);
        return nullptr;
    }

    if (start_seconds > 0) {
        int64_t seekTs = (int64_t)(start_seconds / av_q2d(st->time_base));
        (void)av_seek_frame(fmt, streamIndex, seekTs, AVSEEK_FLAG_BACKWARD);
    }

    // Spawn pump thread last — after all state is valid.
    jf_video_ctx *raw = ctx.release();
    raw->pumpThread = std::thread(pumpThreadMain, raw);

    os_log(jf_video_log(),
           "open: stream #%d %dx%d bits=%d annexB=%d start=%.2fs",
           streamIndex, cctx->width, cctx->height, bits,
           raw->annexB ? 1 : 0, start_seconds);
    return raw;
}

extern "C" void jf_video_close(struct jf_video_ctx *ctx) {
    if (!ctx) return;

    // 1. Flag stop + cancel any blocking avformat call.
    ctx->cancel.store(1);
    ctx->stopFlag.store(true);
    ctx->queueCv.notify_all();

    // 2. Tear down VT FIRST so no new callbacks arrive.
    if (ctx->vtSession) {
        VTDecompressionSessionInvalidate(ctx->vtSession);
        CFRelease(ctx->vtSession);
        ctx->vtSession = nullptr;
    }

    // 3. Join pump (it will have exited on stop_flag or av_read_frame error).
    if (ctx->pumpThread.joinable()) ctx->pumpThread.join();

    // 4. Drain any queued frames.
    {
        std::lock_guard<std::mutex> lock(ctx->queueMutex);
        drainQueueLocked(ctx);
    }

    if (ctx->formatDesc) CFRelease(ctx->formatDesc);
    if (ctx->cctx) avcodec_free_context(&ctx->cctx);
    if (ctx->fmt) avformat_close_input(&ctx->fmt);
    delete ctx;
}

extern "C" void jf_video_cancel(struct jf_video_ctx *ctx) {
    if (!ctx) return;
    ctx->cancel.store(1);
    ctx->stopFlag.store(true);
    ctx->queueCv.notify_all();
}

// ── introspection ───────────────────────────────────────────────────

extern "C" int jf_video_codec_id(struct jf_video_ctx *ctx) {
    if (!ctx || !ctx->cctx) return (int)AV_CODEC_ID_NONE;
    return (int)ctx->cctx->codec_id;
}

// Falls back to profile inference when `bits_per_raw_sample` is not
// populated (happens on some HLS transcodes where the ladder lies).
extern "C" int jf_video_bits_per_sample(struct jf_video_ctx *ctx) {
    if (!ctx || !ctx->cctx) return 0;
    if (ctx->cctx->bits_per_raw_sample > 0) {
        return ctx->cctx->bits_per_raw_sample;
    }
    if (ctx->cctx->codec_id == AV_CODEC_ID_HEVC) {
        switch (ctx->cctx->profile) {
        case AV_PROFILE_HEVC_MAIN_10:
            return 10;
        case AV_PROFILE_HEVC_MAIN:
        case AV_PROFILE_HEVC_MAIN_STILL_PICTURE:
            return 8;
        default:
            break;
        }
    }
    if (ctx->cctx->codec_id == AV_CODEC_ID_H264) {
        switch (ctx->cctx->profile) {
        case AV_PROFILE_H264_HIGH_10:
        case AV_PROFILE_H264_HIGH_10_INTRA:
            return 10;
        default:
            return 8;
        }
    }
    return 0;
}

extern "C" void jf_video_dimensions(struct jf_video_ctx *ctx, int *w, int *h) {
    if (!w || !h) return;
    *w = 0;
    *h = 0;
    if (!ctx || !ctx->cctx) return;
    *w = ctx->cctx->width;
    *h = ctx->cctx->height;
}

// Color info straight off the codec context. Each value is the FFmpeg
// enum (AVColorPrimaries / AVColorTransferCharacteristic /
// AVColorSpace / AVColorRange); Swift maps to the matching
// `kCVImageBuffer*` key constant.
extern "C" void jf_video_color_info(struct jf_video_ctx *ctx,
                                     int *primaries,
                                     int *transfer,
                                     int *matrix,
                                     int *range) {
    if (primaries) *primaries = AVCOL_PRI_UNSPECIFIED;
    if (transfer)  *transfer  = AVCOL_TRC_UNSPECIFIED;
    if (matrix)    *matrix    = AVCOL_SPC_UNSPECIFIED;
    if (range)     *range     = AVCOL_RANGE_UNSPECIFIED;
    if (!ctx || !ctx->cctx) return;
    if (primaries) *primaries = (int)ctx->cctx->color_primaries;
    if (transfer)  *transfer  = (int)ctx->cctx->color_trc;
    if (matrix)    *matrix    = (int)ctx->cctx->colorspace;
    if (range)     *range     = (int)ctx->cctx->color_range;
}

// HDR10 mastering-display metadata. Layout matches FFmpeg's internal
// struct, converted to fixed-point wire format for the Swift side:
//   mastering[0..5]  = display primaries R.x, R.y, G.x, G.y, B.x, B.y
//                      as chromaticity * 50000 (AVRational .den=50000)
//   mastering[6..7]  = white point x, y * 50000
//   mastering[8]     = max luminance (cd/m² * 10000)
//   mastering[9]     = min luminance (cd/m² * 10000)
// Returns 1 if metadata was present, 0 otherwise.
extern "C" int jf_video_hdr_mastering(struct jf_video_ctx *ctx,
                                       uint32_t mastering[10]) {
    if (!ctx || !ctx->cctx || !mastering) return 0;
    memset(mastering, 0, sizeof(uint32_t) * 10);
    AVStream *st = ctx->fmt && ctx->streamIndex >= 0 ?
                   ctx->fmt->streams[ctx->streamIndex] : nullptr;
    if (!st) return 0;
    for (int i = 0; i < st->codecpar->nb_coded_side_data; i++) {
        AVPacketSideData *sd = &st->codecpar->coded_side_data[i];
        if (sd->type != AV_PKT_DATA_MASTERING_DISPLAY_METADATA) continue;
        if (sd->size < (int)sizeof(AVMasteringDisplayMetadata)) continue;
        auto *mdm = (AVMasteringDisplayMetadata *)sd->data;
        auto toFp = [](AVRational r) -> uint32_t {
            if (r.den == 0) return 0;
            // Normalise to 1/50000 chromaticity / 1/10000 luma fixed-point.
            double d = av_q2d(r);
            return (uint32_t)(d * 50000.0);
        };
        if (mdm->has_primaries) {
            mastering[0] = toFp(mdm->display_primaries[0][0]);
            mastering[1] = toFp(mdm->display_primaries[0][1]);
            mastering[2] = toFp(mdm->display_primaries[1][0]);
            mastering[3] = toFp(mdm->display_primaries[1][1]);
            mastering[4] = toFp(mdm->display_primaries[2][0]);
            mastering[5] = toFp(mdm->display_primaries[2][1]);
            mastering[6] = toFp(mdm->white_point[0]);
            mastering[7] = toFp(mdm->white_point[1]);
        }
        if (mdm->has_luminance) {
            mastering[8] = (uint32_t)(av_q2d(mdm->max_luminance) * 10000.0);
            mastering[9] = (uint32_t)(av_q2d(mdm->min_luminance) * 10000.0);
        }
        return 1;
    }
    return 0;
}

extern "C" int jf_video_hdr_cll(struct jf_video_ctx *ctx, uint16_t cll[2]) {
    if (!ctx || !ctx->cctx || !cll) return 0;
    cll[0] = 0;
    cll[1] = 0;
    AVStream *st = ctx->fmt && ctx->streamIndex >= 0 ?
                   ctx->fmt->streams[ctx->streamIndex] : nullptr;
    if (!st) return 0;
    for (int i = 0; i < st->codecpar->nb_coded_side_data; i++) {
        AVPacketSideData *sd = &st->codecpar->coded_side_data[i];
        if (sd->type != AV_PKT_DATA_CONTENT_LIGHT_LEVEL) continue;
        if (sd->size < (int)sizeof(AVContentLightMetadata)) continue;
        auto *clm = (AVContentLightMetadata *)sd->data;
        cll[0] = (uint16_t)clm->MaxCLL;
        cll[1] = (uint16_t)clm->MaxFALL;
        return 1;
    }
    return 0;
}

// Dolby Vision profile extraction. Commit A placeholder — DV config
// parsing is Commit B's problem (needs AV_PKT_DATA_DOVI_CONF
// side-data + RPU detection on first frame).
extern "C" int jf_video_dolby_vision_profile(struct jf_video_ctx *ctx) {
    (void)ctx;
    return -1;
}

// ── decode loop ─────────────────────────────────────────────────────
// Pops the earliest-PTS decoded frame from the bounded output queue.
// Blocks up to `timeout_seconds`. Ownership of the returned pixel
// buffer transfers to the caller — CFRelease when done (or pass as
// `Unmanaged.takeRetainedValue` on the Swift side).
//
// Return codes:
//    0 = frame ready
//    1 = EOF (pump finished, queue drained)
//   -1 = error / closed
//   -2 = timeout (no frame within window)
extern "C" int jf_video_decode_next(struct jf_video_ctx *ctx,
                                     double timeout_seconds,
                                     void **out_pixel_buffer,
                                     double *out_pts_seconds,
                                     int *out_is_keyframe) {
    if (!ctx) return -1;
    if (out_pixel_buffer) *out_pixel_buffer = nullptr;
    if (out_pts_seconds) *out_pts_seconds = 0;
    if (out_is_keyframe) *out_is_keyframe = 0;

    std::unique_lock<std::mutex> lock(ctx->queueMutex);
    auto deadline = std::chrono::steady_clock::now()
                    + std::chrono::duration<double>(timeout_seconds);

    const bool ready = ctx->queueCv.wait_until(lock, deadline, [&] {
        if (ctx->stopFlag.load()) return true;
        if (ctx->pumpEof.load()) return true; // emit whatever is left, or EOF
        return ctx->outQueue.size() >= ctx->reorderWindow;
    });

    if (ctx->stopFlag.load()) return -1;
    if (!ready) return -2;

    if (ctx->outQueue.empty()) {
        return ctx->pumpEof.load() ? 1 : -2;
    }

    DecodedFrame frame = ctx->outQueue.front();
    ctx->outQueue.pop_front();
    lock.unlock();
    ctx->queueCv.notify_all();

    if (out_pixel_buffer) *out_pixel_buffer = (void *)frame.buffer; // retained
    else if (frame.buffer) CFRelease(frame.buffer); // caller didn't want it
    if (out_pts_seconds) *out_pts_seconds = frame.pts_seconds;
    if (out_is_keyframe) *out_is_keyframe = frame.is_keyframe ? 1 : 0;
    return 0;
}

extern "C" int jf_video_seek(struct jf_video_ctx *ctx, double seconds) {
    if (!ctx) return -1;
    std::lock_guard<std::mutex> sl(ctx->seekMutex);
    ctx->pendingSeek = seconds;
    // Nudge the pump in case it's parked on queue backpressure.
    ctx->queueCv.notify_all();
    return 0;
}

// Exposes the CMFormatDescription for the decoded pixel buffers so the
// Swift side can build display-layer CMSampleBuffers downstream. Caller
// does not own the reference; do not release.
extern "C" void *jf_video_format_description(struct jf_video_ctx *ctx) {
    if (!ctx) return nullptr;
    return (void *)ctx->formatDesc;
}

// Pixel format chosen by the VT session. Swift uses this for logging
// and pipeline sanity checks.
extern "C" uint32_t jf_video_pixel_format(struct jf_video_ctx *ctx) {
    if (!ctx) return 0;
    return (uint32_t)ctx->pixelFormat;
}
