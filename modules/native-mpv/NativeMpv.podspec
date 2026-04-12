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
    "HEADER_SEARCH_PATHS" => [
      "$(inherited)",
      "$(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-device/include",
      "${PODS_ROOT}/RCT-Folly",
    ].join(" "),
    "SWIFT_INCLUDE_PATHS[sdk=iphoneos*]"         => "$(inherited) $(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-device/include",
    "SWIFT_INCLUDE_PATHS[sdk=iphonesimulator*]"  => "$(inherited) $(PODS_TARGET_SRCROOT)/vendor/ios/mpvkit-simulator/include",
    "LIBRARY_SEARCH_PATHS[sdk=iphoneos*]"        => "$(inherited) " + mpvkit_device,
    "LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]" => "$(inherited) " + mpvkit_sim,
    "OTHER_LDFLAGS"                              => "$(inherited) " + other_ldflags,
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) FOLLY_NO_CONFIG FOLLY_CFG_NO_COROUTINES",
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

  # RN/Nitro plumbing.
  s.dependency "React-jsi"
  s.dependency "React-callinvoker"

  load "nitrogen/generated/ios/NativeMpv+autolinking.rb"
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
