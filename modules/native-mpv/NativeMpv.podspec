require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# MPVKit XCFrameworks are downloaded + flattened into
# vendor/ios/mpvkit-{device,simulator} by `scripts/fetch-mpvkit.sh`.
# The script must run before `pod install` — the app's package.json
# wires a `postinstall` hook that invokes it.
#
# See memory `project_jellyfuse_mpv_player.md` and the Rust reference
# at `/Users/antonincarlin/projects/fusion/Makefile::fetch-mpvkit-ios`
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
    "HEADER_SEARCH_PATHS" => [
      "$(inherited)",
      "${PODS_ROOT}/RCT-Folly",
    ].join(" "),
    "OTHER_CFLAGS" => "$(inherited) -isystem $(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-device/include",
    "SWIFT_INCLUDE_PATHS[sdk=iphoneos*]"         => "$(inherited) $(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-device/include",
    "SWIFT_INCLUDE_PATHS[sdk=iphonesimulator*]"  => "$(inherited) $(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-simulator/include",
    "LIBRARY_SEARCH_PATHS[sdk=iphoneos*]"        => "$(inherited) " + mpvkit_device,
    "LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]" => "$(inherited) " + mpvkit_sim,
    "OTHER_LDFLAGS"                              => "$(inherited) " + other_ldflags,
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) FOLLY_NO_CONFIG FOLLY_CFG_NO_COROUTINES",
    # -fno-modules disables Clang's modular include system for the
    # .cpp files in this pod. Xcode 26's objcxx interop compiles C++
    # in a modular context where POSIX types (time_t, tm, nanosleep)
    # aren't transitively exported from the C++ STL module — an
    # Apple SDK bug. Disabling modules for C++ falls back to textual
    # includes where the transitive chain works normally. Swift
    # modules are unaffected (they use a separate import system).
    "OTHER_CPLUSPLUSFLAGS"         => "$(inherited) -fno-modules -DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1",
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

  # RN/Nitro plumbing.
  s.dependency "React-jsi"
  s.dependency "React-callinvoker"

  load "nitrogen/generated/ios/NativeMpv+autolinking.rb"
  add_nitrogen_files(s)

  install_modules_dependencies(s)

  # ── Xcode 26 workaround ─────────────────────────────────────────────
  # Nitrogen's autolinking + install_modules_dependencies both merge
  # into pod_target_xcconfig and may overwrite our earlier settings.
  # Apply the Xcode 26 fix AFTER all merges so it sticks.
  #
  # The C++ STL module on iOS SDK 26.2 doesn't re-export POSIX types
  # (time_t, tm, nanosleep) under the objcxx interop context.
  # Disabling Clang modules for this pod's C++ files falls back to
  # textual includes where the transitive chain works normally.
  # Swift modules are a separate system and stay unaffected.
  xcconfig = s.attributes_hash["pod_target_xcconfig"] || {}
  # Disable Clang modules entirely for this pod. All generated files
  # use #include / #import (not @import), so modules aren't needed.
  # Swift has its own module system that's unaffected.
  xcconfig["CLANG_ENABLE_MODULES"] = "NO"
  s.pod_target_xcconfig = xcconfig
end
