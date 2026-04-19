// Phase 3 bitmap-sub shim (see docs/native-video-pipeline.md). Exports
// pure-C symbols picked up by Swift via @_silgen_name in
// HybridNativeMpv.swift — no bridging header / modulemap needed for
// these diagnostic probes. When the full BitmapSubDecoder API lands
// (open / decode-loop / seek with streaming RGBA transfer) we'll
// promote this to a proper header + module setup.
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

// Opens `url`, finds the first bitmap-sub stream, decodes up to
// `max_events` subtitle events, and logs PTS / duration / per-rect
// geometry for each. Synchronous — callers must run on a background
// queue. Purely diagnostic: validates that the PGS / VobSub / DVB
// decoder path works end-to-end before we wire up RGBA transfer and
// the Nitro-exposed streaming API.
extern "C" int jf_bitmap_sub_test_decode(const char *url, int max_events) {
    if (!url) return -1;
    if (max_events <= 0) max_events = 20;
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
        os_log_error(jf_ffmpeg_log(), "decode: open_input failed rc=%d (%{public}s)", rc, err);
        return -1;
    }

    rc = avformat_find_stream_info(fmt, nullptr);
    if (rc < 0) {
        os_log_error(jf_ffmpeg_log(), "decode: find_stream_info failed");
        avformat_close_input(&fmt);
        return -1;
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
        os_log(jf_ffmpeg_log(), "decode: no bitmap sub stream found");
        avformat_close_input(&fmt);
        return 0;
    }

    // Skip every other stream at the demux layer — saves bandwidth +
    // in-memory packet copies. We only need this one sub track.
    for (unsigned i = 0; i < fmt->nb_streams; i++) {
        fmt->streams[i]->discard = (int(i) == streamIndex) ? AVDISCARD_DEFAULT : AVDISCARD_ALL;
    }

    AVStream *st = fmt->streams[streamIndex];
    const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
    if (!codec) {
        os_log_error(jf_ffmpeg_log(),
                     "decode: no decoder for codec id %d",
                     (int)st->codecpar->codec_id);
        avformat_close_input(&fmt);
        return -1;
    }

    AVCodecContext *cctx = avcodec_alloc_context3(codec);
    if (!cctx) {
        avformat_close_input(&fmt);
        return -1;
    }
    if (avcodec_parameters_to_context(cctx, st->codecpar) < 0) {
        avcodec_free_context(&cctx);
        avformat_close_input(&fmt);
        return -1;
    }
    if (avcodec_open2(cctx, codec, nullptr) < 0) {
        os_log_error(jf_ffmpeg_log(), "decode: avcodec_open2 failed");
        avcodec_free_context(&cctx);
        avformat_close_input(&fmt);
        return -1;
    }

    AVDictionaryEntry *lang = av_dict_get(st->metadata, "language", nullptr, 0);
    os_log(jf_ffmpeg_log(),
           "decode: stream #%d codec=%{public}s lang=%{public}s — decoding up to %d events",
           streamIndex,
           codec->name,
           lang ? lang->value : "?",
           max_events);

    AVPacket *pkt = av_packet_alloc();
    int decoded = 0;

    while (decoded < max_events) {
        rc = av_read_frame(fmt, pkt);
        if (rc == AVERROR_EOF) break;
        if (rc < 0) {
            char err[AV_ERROR_MAX_STRING_SIZE] = {0};
            av_strerror(rc, err, sizeof(err));
            os_log_error(jf_ffmpeg_log(), "decode: read_frame failed (%{public}s)", err);
            break;
        }
        if (pkt->stream_index != streamIndex) {
            av_packet_unref(pkt);
            continue;
        }

        AVSubtitle sub;
        int got = 0;
        rc = avcodec_decode_subtitle2(cctx, &sub, &got, pkt);
        if (rc < 0) {
            os_log_error(jf_ffmpeg_log(), "decode: decode_subtitle2 failed");
            av_packet_unref(pkt);
            continue;
        }
        if (!got) {
            av_packet_unref(pkt);
            continue;
        }

        double pts_seconds = 0;
        if (pkt->pts != AV_NOPTS_VALUE) {
            pts_seconds = (double)pkt->pts * av_q2d(st->time_base);
        }
        // sub.start/end_display_time are milliseconds RELATIVE to the
        // packet PTS. The final screen-out window is pts + start → pts + end.
        double start_ms = (double)sub.start_display_time;
        double end_ms = (double)sub.end_display_time;
        double duration_s =
            (end_ms > start_ms && end_ms != (double)UINT32_MAX) ? (end_ms - start_ms) / 1000.0
                                                                : 0.0;

        os_log(jf_ffmpeg_log(),
               "decode: event #%d pts=%.3f dur=%.3f rects=%u",
               decoded,
               pts_seconds,
               duration_s,
               sub.num_rects);

        for (unsigned r = 0; r < sub.num_rects; r++) {
            AVSubtitleRect *rect = sub.rects[r];
            const char *pixFmtName = av_get_pix_fmt_name((AVPixelFormat)AV_PIX_FMT_PAL8);
            // PGS rects are always PAL8 (8-bit palette indexed) — we log
            // the declared format just to spot anything unusual that would
            // need a different decode path.
            os_log(jf_ffmpeg_log(),
                   "  rect[%u] pos=(%d,%d) size=%dx%d nb_colors=%d fmt=%{public}s",
                   r,
                   rect->x,
                   rect->y,
                   rect->w,
                   rect->h,
                   rect->nb_colors,
                   pixFmtName ? pixFmtName : "?");
        }

        avsubtitle_free(&sub);
        av_packet_unref(pkt);
        decoded++;
    }

    os_log(jf_ffmpeg_log(), "decode: finished, %d event(s) decoded", decoded);

    av_packet_free(&pkt);
    avcodec_free_context(&cctx);
    avformat_close_input(&fmt);
    return decoded;
}
