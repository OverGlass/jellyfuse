// Phase 3 bitmap-sub shim (see docs/native-video-pipeline.md). Exports
// pure-C symbols picked up by Swift via @_silgen_name in
// HybridNativeMpv.swift — no bridging header / modulemap needed for
// these diagnostic probes. When the full BitmapSubDecoder API lands
// (open / decode-loop / seek) we'll promote this to a proper header +
// module setup.
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
}

#include <dispatch/dispatch.h>
#include <os/log.h>

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

// Probes `url` for subtitle streams via a parallel avformat context
// and logs the codec + language for each one. Blocks for the HTTP
// handshake + header read — callers must run on a background queue.
// Synchronous return; the real decoder API will be event-driven.
extern "C" void jf_bitmap_sub_probe(const char *url) {
    if (!url) return;
    jf_ffmpeg_init_once();

    AVFormatContext *ctx = nullptr;
    AVDictionary *opts = nullptr;
    // 10-second read/write cap so a server hiccup doesn't wedge the
    // background queue forever. Value in microseconds.
    av_dict_set(&opts, "rw_timeout", "10000000", 0);
    av_dict_set(&opts, "user_agent", "Jellyfuse/1.0 libavformat", 0);

    int rc = avformat_open_input(&ctx, url, nullptr, &opts);
    av_dict_free(&opts);
    if (rc < 0) {
        char err[AV_ERROR_MAX_STRING_SIZE] = {0};
        av_strerror(rc, err, sizeof(err));
        os_log_error(jf_ffmpeg_log(), "probe: open_input failed rc=%d (%{public}s)", rc, err);
        return;
    }

    rc = avformat_find_stream_info(ctx, nullptr);
    if (rc < 0) {
        char err[AV_ERROR_MAX_STRING_SIZE] = {0};
        av_strerror(rc, err, sizeof(err));
        os_log_error(jf_ffmpeg_log(), "probe: find_stream_info failed (%{public}s)", err);
        avformat_close_input(&ctx);
        return;
    }

    unsigned subCount = 0;
    for (unsigned i = 0; i < ctx->nb_streams; i++) {
        AVStream *st = ctx->streams[i];
        if (st->codecpar->codec_type != AVMEDIA_TYPE_SUBTITLE) continue;
        const AVCodecDescriptor *desc = avcodec_descriptor_get(st->codecpar->codec_id);
        AVDictionaryEntry *lang = av_dict_get(st->metadata, "language", nullptr, 0);
        AVDictionaryEntry *title = av_dict_get(st->metadata, "title", nullptr, 0);
        os_log(jf_ffmpeg_log(),
               "probe: sub stream #%u codec=%{public}s (id=%d) lang=%{public}s title=%{public}s",
               i,
               desc ? desc->name : "?",
               (int)st->codecpar->codec_id,
               lang ? lang->value : "?",
               title ? title->value : "?");
        subCount++;
    }
    os_log(jf_ffmpeg_log(),
           "probe: %u subtitle stream(s) found across %u total",
           subCount,
           ctx->nb_streams);

    avformat_close_input(&ctx);
}
