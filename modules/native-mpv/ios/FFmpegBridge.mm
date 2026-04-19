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
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/dict.h>
#include <libavutil/error.h>
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

extern "C" struct jf_bitmap_sub_ctx *jf_bitmap_sub_open(const char *url,
                                                         double start_seconds) {
    if (!url) return nullptr;
    jf_ffmpeg_init_once();

    AVFormatContext *fmt = nullptr;
    AVDictionary *opts = nullptr;
    av_dict_set(&opts, "rw_timeout", "15000000", 0);
    av_dict_set(&opts, "user_agent", "Jellyfuse/1.0 libavformat", 0);

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
