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

#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <MobileCoreServices/UTCoreTypes.h>

#include <dispatch/dispatch.h>
#include <os/log.h>
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

// One-shot diagnostic: convert the first decoded PAL8 rect to RGBA and
// write a PNG to NSTemporaryDirectory(). We need this before building
// the streaming pipeline to confirm the palette byte order — ffmpeg
// hands us `rect->data[1]` as a 256-entry uint32_t palette, but the
// layout (ARGB / RGBA / endianness) is not trivially documented for
// each codec. A garbled PNG here would mean all downstream frames are
// miscolored; better to catch it with a single static image we can
// eyeball than after wiring up the full Metal texture pipeline.
static void jf_dump_rect_png(const AVSubtitleRect *rect, double pts_seconds) {
    if (!rect || rect->w <= 0 || rect->h <= 0) return;
    if (!rect->data[0] || !rect->data[1]) return;

    const int w = rect->w;
    const int h = rect->h;
    const int stride = rect->linesize[0];
    const uint32_t *palette = (const uint32_t *)rect->data[1];
    const uint8_t *indices = rect->data[0];

    std::vector<uint8_t> rgba((size_t)w * (size_t)h * 4, 0);
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            uint8_t idx = indices[y * stride + x];
            uint32_t argb = palette[idx];
            uint8_t a = (argb >> 24) & 0xff;
            uint8_t r = (argb >> 16) & 0xff;
            uint8_t g = (argb >>  8) & 0xff;
            uint8_t b = (argb >>  0) & 0xff;
            uint8_t *p = &rgba[((size_t)y * (size_t)w + (size_t)x) * 4];
            p[0] = r; p[1] = g; p[2] = b; p[3] = a;
        }
    }

    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    CGBitmapInfo bi = (CGBitmapInfo)(kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGContextRef ctx = CGBitmapContextCreate(rgba.data(), (size_t)w, (size_t)h,
                                             8, (size_t)w * 4, cs, bi);
    CGColorSpaceRelease(cs);
    if (!ctx) {
        os_log_error(jf_ffmpeg_log(), "dump: CGBitmapContextCreate failed");
        return;
    }
    CGImageRef img = CGBitmapContextCreateImage(ctx);
    CGContextRelease(ctx);
    if (!img) {
        os_log_error(jf_ffmpeg_log(), "dump: CGBitmapContextCreateImage failed");
        return;
    }

    NSString *filename = [NSString stringWithFormat:@"jf-pgs-%.3f.png", pts_seconds];
    NSArray<NSString *> *docs =
        NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES);
    NSString *dir = docs.firstObject ?: NSTemporaryDirectory();
    NSString *path = [dir stringByAppendingPathComponent:filename];
    NSURL *url = [NSURL fileURLWithPath:path];
    CGImageDestinationRef dest =
        CGImageDestinationCreateWithURL((CFURLRef)url, kUTTypePNG, 1, nullptr);
    if (!dest) {
        CGImageRelease(img);
        os_log_error(jf_ffmpeg_log(), "dump: CGImageDestinationCreateWithURL failed");
        return;
    }
    CGImageDestinationAddImage(dest, img, nullptr);
    bool ok = CGImageDestinationFinalize(dest);
    CFRelease(dest);
    CGImageRelease(img);

    os_log(jf_ffmpeg_log(),
           "dump: wrote %dx%d PNG ok=%d → %{public}s",
           w, h, ok ? 1 : 0, path.UTF8String);
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

// Opens `url`, finds the first bitmap-sub stream, seeks to
// `start_seconds`, and decodes up to `max_events` subtitle events —
// logs PTS / duration / per-rect geometry for each. Synchronous —
// callers must run on a background queue. Purely diagnostic:
// validates that the PGS / VobSub / DVB decoder path works end-to-end
// before we wire up RGBA transfer and the Nitro-exposed streaming
// API.
//
// The seek matters because PGS packets are sparse (typically minutes
// apart for dialogue subs). Starting from byte 0 means av_read_frame
// has to stream over tens of MB of video chunks before it hits the
// first sub packet. Seeking to mpv's resume position lines the
// sidecar up with where the user will actually see captions.
extern "C" int jf_bitmap_sub_test_decode(const char *url, double start_seconds,
                                         int max_events) {
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
           "decode: stream #%d codec=%{public}s lang=%{public}s — seek=%.2fs max=%d",
           streamIndex,
           codec->name,
           lang ? lang->value : "?",
           start_seconds,
           max_events);

    // Seek to the requested start so we don't have to stream through
    // minutes of video to find the first sub packet. AVSEEK_FLAG_ANY
    // lets ffmpeg land on any frame (for subs there are no keyframes),
    // and we use the sub stream's own time_base so the timestamp
    // resolves in the same units the packet PTSs will carry.
    if (start_seconds > 0) {
        int64_t seekTs = (int64_t)(start_seconds / av_q2d(st->time_base));
        int srv = av_seek_frame(fmt, streamIndex, seekTs, AVSEEK_FLAG_BACKWARD);
        if (srv < 0) {
            char err[AV_ERROR_MAX_STRING_SIZE] = {0};
            av_strerror(srv, err, sizeof(err));
            os_log(jf_ffmpeg_log(), "decode: seek failed (%{public}s) — continuing from 0", err);
        }
    }

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

        static bool dumped = false;
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

            if (!dumped && rect->w > 0 && rect->h > 0 && rect->data[0] && rect->data[1]) {
                jf_dump_rect_png(rect, pts_seconds);
                dumped = true;
            }
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
