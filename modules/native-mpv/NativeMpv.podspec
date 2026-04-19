require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# MPVKit XCFrameworks are downloaded + flattened into
# vendor/ios/mpvkit-{device,simulator} by `scripts/fetch-mpvkit.sh`.
# The script must run before `pod install` — the app's package.json
# wires a `postinstall` hook that invokes it.
#
# See memory `project_jellyfuse_mpv_player.md` and the Rust reference
# at `../fusion/Makefile::fetch-mpvkit-ios`
# for the canonical list + version pins.
MPVKIT_VERSION = "0.41.0"

# All .a files that the fetch script produces. The podspec picks the
# correct directory per slice via the `xcconfig` conditionals below.
MPVKIT_LIBS = [
  "mpv",
  "avcodec", "avdevice", "avformat", "avfilter", "avutil",
  "swresample", "swscale",
  "crypto", "ssl",
  "gmp", "nettle", "hogweed", "gnutls",
  "unibreak", "freetype", "fribidi", "harfbuzz", "ass",
  "smbclient", "bluray", "uavs3d", "dovi",
  "MoltenVK",
  "shaderc_combined",
  "lcms2", "placebo", "dav1d", "uchardet", "luajit"
]

Pod::Spec.new do |s|
  s.name         = "NativeMpv"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/arkbase/jellyfuse"
  s.license      = { :type => "MIT" }
  s.authors      = "Arkbase"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => ".", :tag => s.version.to_s }

  s.source_files = [
    "ios/**/*.{swift,h,m,mm}",
  ]

  # ── MPVKit static libs ─────────────────────────────────────────────────
  # `vendored_libraries` can't handle per-slice paths directly, so we
  # ship a single -L path per SDK via xcconfig. The symlinks in
  # vendor/ios/mpvkit-{device,simulator} point into the shared cache
  # at ~/Library/Caches/jellyfuse/mpvkit-ios/$VERSION which
  # scripts/fetch-mpvkit.sh maintains.
  mpvkit_device = "$(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-device"
  mpvkit_sim    = "$(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-simulator"

  other_ldflags = MPVKIT_LIBS.map { |name| "-l#{name}" }.join(" ")

  s.pod_target_xcconfig = {
    # $(inherited) on every path setting so we APPEND to the Pods
    # project defaults rather than clobbering them — without it,
    # Swift can't find NitroModules and the build fails with
    # "cannot find type 'HybridObject' in scope".
    #
    # MPVKit headers are added via -isystem (not -I) because the
    # vendored include/ contains an FFmpeg `time.h` that shadows
    # the system `<time.h>`. With -I the shadow breaks `<ctime>` →
    # `time_t` resolution. -isystem searches AFTER system headers
    # so the real `<time.h>` wins and the C++ STL compiles correctly.
    # `include-ffmpeg/` is the Phase 3 sidecar (see
    # docs/native-video-pipeline.md) — public FFmpeg headers nested
    # under `libavcodec/`, `libavutil/`, … prefix dirs, used only by
    # our bitmap-sub C shim. No top-level `time.h` exists there, so
    # no shadow risk this time around.
    "HEADER_SEARCH_PATHS" => [
      "$(inherited)",
      "${PODS_ROOT}/RCT-Folly",
    ].join(" "),
    "OTHER_CFLAGS" => [
      "$(inherited)",
      "-isystem $(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-device/include",
      "-isystem $(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-device/include-ffmpeg",
    ].join(" "),
    "SWIFT_INCLUDE_PATHS[sdk=iphoneos*]"         => "$(inherited) $(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-device/include",
    "SWIFT_INCLUDE_PATHS[sdk=iphonesimulator*]"  => "$(inherited) $(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-simulator/include",
    # LIBRARY_SEARCH_PATHS + OTHER_LDFLAGS for MPVKit are set via
    # s.xcconfig below (not pod_target_xcconfig) so they propagate
    # to the consuming app target where the actual linking happens.
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) FOLLY_NO_CONFIG FOLLY_CFG_NO_COROUTINES GLES_SILENCE_DEPRECATION=1",
    "OTHER_CPLUSPLUSFLAGS"         => "$(inherited) -DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1",
  }

  # System frameworks libmpv + ffmpeg + deps pull in transitively.
  # Mirrors the Rust `jf-module-player/build.rs` iOS link list.
  s.frameworks = [
    "AVFoundation",
    "AudioToolbox",
    "CoreMedia",
    "CoreVideo",
    "VideoToolbox",
    "CoreGraphics",
    "CoreImage",
    "CoreText",
    "CoreFoundation",
    "QuartzCore",
    "Metal",
    "Security",
    "OpenGLES",
    "UIKit",
  ]
  s.libraries = ["iconv", "c++", "z", "bz2", "xml2"]

  # ── Propagate MPVKit linker flags to the consuming app ───────────────
  # s.xcconfig (aka user_target_xcconfig) applies to targets that
  # DEPEND on this pod — i.e. the main Jellyfuse app binary. Without
  # this, the app's linker can't find -lmpv -lavcodec etc. because
  # pod_target_xcconfig only affects OUR pod's intermediate .a build,
  # not the final link step.
  # s.xcconfig uses paths relative to PODS_ROOT (the Pods dir in the
  # app's ios/ directory). PODS_TARGET_SRCROOT is only defined in
  # pod_target_xcconfig and is blank in the consumer. We derive the
  # path from PODS_ROOT instead.
  mpvkit_device_consumer = "#{mpvkit_device.sub('$(PODS_TARGET_SRCROOT)', '$(PODS_ROOT)/../../../../modules/native-mpv')}"
  mpvkit_sim_consumer    = "#{mpvkit_sim.sub('$(PODS_TARGET_SRCROOT)', '$(PODS_ROOT)/../../../../modules/native-mpv')}"
  s.xcconfig = {
    "LIBRARY_SEARCH_PATHS[sdk=iphoneos*]"        => "$(inherited) " + mpvkit_device_consumer,
    "LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]" => "$(inherited) " + mpvkit_sim_consumer,
    "OTHER_LDFLAGS"                              => "$(inherited) " + other_ldflags,
  }

  # RN/Nitro plumbing.
  s.dependency "React-jsi"
  s.dependency "React-callinvoker"

  load "nitrogen/generated/ios/NativeMpv+autolinking.rb"
  add_nitrogen_files(s)

  install_modules_dependencies(s)

  # ── Objective-C++ for view support ──────────────────────────────────
  # The Nitro-generated NativeMpv-Swift-Cxx-Bridge.cpp includes the
  # auto-generated NativeMpv-Swift.h which references UIView (from
  # HybridMpvVideoView.view). UIView is an Objective-C type — pure
  # C++ can't parse UIKit headers. Compiling all .cpp as ObjC++ lets
  # the bridge resolve UIKit types correctly.
  xcconfig = s.attributes_hash["pod_target_xcconfig"] || {}
  xcconfig["GCC_INPUT_FILETYPE"] = "sourcecode.cpp.objcpp"
  s.pod_target_xcconfig = xcconfig
end
