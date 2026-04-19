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
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <MobileCoreServices/UTCoreTypes.h>

#include <atomic>
#include <dispatch/dispatch.h>
#include <os/log.h>
#include <stdlib.h>
#include <string.h>

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
// Commit A scope (this block): open + close + cancel + metadata
// introspection. Decode is wired in Commit B — `jf_video_decode_next`
// returns -1 as a placeholder so the Swift-side harness can prove the
// plumbing without VideoToolbox online yet.

static os_log_t jf_video_log(void) {
    static os_log_t log;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        log = os_log_create("com.jellyfuse.app", "VideoSidecar");
    });
    return log;
}

struct jf_video_ctx {
    AVFormatContext *fmt;
    AVCodecContext *cctx;
    AVBSFContext *bsf;
    int streamIndex;
    AVRational timeBase;
    AVPacket *pkt;
    std::atomic<int> cancel;
};

static int jf_video_interrupt(void *opaque) {
    auto *ctx = (struct jf_video_ctx *)opaque;
    return ctx && ctx->cancel.load() ? 1 : 0;
}

// Pick the bitstream filter that converts the stream's NALU packaging
// into Annex-B byte-stream, which is what VideoToolbox consumes.
// `nullptr` => stream is already Annex-B (TS, raw HEVC/H.264); use an
// identity filter ("null") so the pipeline shape stays uniform.
static const char *bsf_name_for_codec(AVCodecID id, const uint8_t *extradata,
                                       int extradata_size) {
    const bool looksHvcc = (extradata_size > 0 && extradata && extradata[0] == 1);
    switch (id) {
    case AV_CODEC_ID_H264:
        return looksHvcc ? "h264_mp4toannexb" : "null";
    case AV_CODEC_ID_HEVC:
        return looksHvcc ? "hevc_mp4toannexb" : "null";
    default:
        return "null";
    }
}

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
    const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
    if (!codec) {
        os_log_error(jf_video_log(), "open: no decoder for codec %d",
                     (int)st->codecpar->codec_id);
        avformat_close_input(&fmt);
        return nullptr;
    }

    AVCodecContext *cctx = avcodec_alloc_context3(codec);
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
    // context is here purely as a typed bundle of parameters + side
    // data that the BSF needs and the Swift side reads for metadata.

    const char *bsfName = bsf_name_for_codec(st->codecpar->codec_id,
                                              st->codecpar->extradata,
                                              st->codecpar->extradata_size);
    const AVBitStreamFilter *bsf = av_bsf_get_by_name(bsfName);
    if (!bsf) {
        os_log_error(jf_video_log(), "open: bsf '%{public}s' not found", bsfName);
        avcodec_free_context(&cctx);
        avformat_close_input(&fmt);
        return nullptr;
    }
    AVBSFContext *bsfCtx = nullptr;
    if (av_bsf_alloc(bsf, &bsfCtx) < 0) {
        avcodec_free_context(&cctx);
        avformat_close_input(&fmt);
        return nullptr;
    }
    if (avcodec_parameters_copy(bsfCtx->par_in, st->codecpar) < 0) {
        av_bsf_free(&bsfCtx);
        avcodec_free_context(&cctx);
        avformat_close_input(&fmt);
        return nullptr;
    }
    bsfCtx->time_base_in = st->time_base;
    if (av_bsf_init(bsfCtx) < 0) {
        av_bsf_free(&bsfCtx);
        avcodec_free_context(&cctx);
        avformat_close_input(&fmt);
        return nullptr;
    }

    if (start_seconds > 0) {
        int64_t seekTs = (int64_t)(start_seconds / av_q2d(st->time_base));
        (void)av_seek_frame(fmt, streamIndex, seekTs, AVSEEK_FLAG_BACKWARD);
    }

    auto *ctx = new jf_video_ctx();
    ctx->fmt = fmt;
    ctx->cctx = cctx;
    ctx->bsf = bsfCtx;
    ctx->streamIndex = streamIndex;
    ctx->timeBase = st->time_base;
    ctx->pkt = av_packet_alloc();
    ctx->cancel.store(0);
    fmt->interrupt_callback.callback = jf_video_interrupt;
    fmt->interrupt_callback.opaque = ctx;

    os_log(jf_video_log(),
           "open: stream #%d codec=%{public}s %dx%d bsf=%{public}s start=%.2fs",
           streamIndex, codec->name, cctx->width, cctx->height, bsfName,
           start_seconds);
    return ctx;
}

extern "C" void jf_video_close(struct jf_video_ctx *ctx) {
    if (!ctx) return;
    ctx->cancel.store(1);
    if (ctx->pkt) av_packet_free(&ctx->pkt);
    if (ctx->bsf) av_bsf_free(&ctx->bsf);
    if (ctx->cctx) avcodec_free_context(&ctx->cctx);
    if (ctx->fmt) avformat_close_input(&ctx->fmt);
    delete ctx;
}

extern "C" void jf_video_cancel(struct jf_video_ctx *ctx) {
    if (!ctx) return;
    ctx->cancel.store(1);
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

// ── decode loop (Commit B) ──────────────────────────────────────────
// Placeholder until VideoToolbox wiring lands. Harness-only builds
// never reach this; the `debug_enableNativeVideoHarness` path in Swift
// only calls open + introspection + close.

extern "C" int jf_video_decode_next(struct jf_video_ctx *ctx,
                                     double *out_pts_seconds,
                                     void **out_pixel_buffer) {
    (void)ctx;
    if (out_pts_seconds) *out_pts_seconds = 0;
    if (out_pixel_buffer) *out_pixel_buffer = nullptr;
    return -1;
}

extern "C" int jf_video_seek(struct jf_video_ctx *ctx, double seconds) {
    (void)ctx;
    (void)seconds;
    return -1;
}
