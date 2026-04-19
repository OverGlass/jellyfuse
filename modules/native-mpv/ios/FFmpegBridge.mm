// Phase 3 link-test shim (see docs/native-video-pipeline.md). The
// exported C symbol is picked up by Swift via @_silgen_name in
// HybridNativeMpv.swift — no bridging header / modulemap needed for
// this one-off. When the real BitmapSubDecoder API lands, we'll
// promote this to a proper header + module setup.

// MPVKit's FFmpeg public headers ship WITHOUT `extern "C"` guards.
// This file compiles as Objective-C++ (pod-wide GCC_INPUT_FILETYPE=
// sourcecode.cpp.objcpp), which would otherwise mangle av_* symbol
// references and break the link. Wrap at the include site.
extern "C" {
#include <libavutil/avutil.h>
}

extern "C" const char *jf_ffmpeg_version_info(void) {
    return av_version_info();
}
