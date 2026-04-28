require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# libmpv-apple XCFrameworks (built from our mpv hard fork) are flattened
# into vendor/ios/libmpv-{device,simulator} by `scripts/fetch-libmpv.sh`.
# The script must run before `pod install` — the app's package.json
# wires a postinstall hook that invokes it.
#
# The fork lives at github.com/<arkbase>/mpv-apple. While we are still
# local-dev (no GH releases yet), fetch-libmpv.sh sources from a sibling
# clone at ~/projects/mpv-apple/build/xcframeworks/. The version string is
# "local-dev" until we tag the first release.
#
# See `.claude/plans/i-want-to-do-polished-wolf.md` §Phase 0a / 0b and
# memory `project_player_rewrite_decisions.md`.
LIBMPV_VERSION = "local-dev"

# Static archives the fetch script produces, in link order. The fork
# replaces the larger MPVKit set:
#   - openssl/gnutls dropped (TLS via Security.framework)
#   - libsmbclient, libbluray, libuavs3d, libdovi, libluajit, libuchardet
#     dropped (not needed for a Jellyfin client)
#   - dav1d compiled into ffmpeg, no separate libdav1d.a
#   - shaderc not built (libplacebo configured without runtime shader
#     compilation; revisit if a feature surfaces that needs it)
LIBMPV_LIBS = [
  "mpv",
  "avcodec", "avfilter", "avformat", "avutil",
  "swresample", "swscale", "postproc",
  "placebo",
  "MoltenVK",
  "ass", "freetype", "fribidi", "harfbuzz", "unibreak",
  "lcms2",
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

  # ── libmpv-apple static libs ────────────────────────────────────────────
  # `vendored_libraries` can't handle per-slice paths directly, so we ship
  # a single -L path per SDK via xcconfig. The symlinks in
  # vendor/ios/libmpv-{device,simulator} point into the shared cache at
  # ~/Library/Caches/jellyfuse/libmpv-apple/$LIBMPV_VERSION which
  # scripts/fetch-libmpv.sh maintains.
  libmpv_device = "$(PODS_TARGET_SRCROOT)/vendor/ios/libmpv-device"
  libmpv_sim    = "$(PODS_TARGET_SRCROOT)/vendor/ios/libmpv-simulator"

  other_ldflags = LIBMPV_LIBS.map { |name| "-l#{name}" }.join(" ")

  s.pod_target_xcconfig = {
    # $(inherited) on every path setting so we APPEND to the Pods project
    # defaults rather than clobbering them — without it, Swift can't find
    # NitroModules and the build fails with "cannot find type
    # 'HybridObject' in scope".
    #
    # libmpv-apple headers are added via -isystem (not -I) because the
    # vendored include/ contains an FFmpeg `time.h` that shadows the
    # system `<time.h>`. With -I the shadow breaks `<ctime>` → `time_t`
    # resolution. -isystem searches AFTER system headers so the real
    # `<time.h>` wins and the C++ STL compiles correctly.
    "HEADER_SEARCH_PATHS" => [
      "$(inherited)",
      "${PODS_ROOT}/RCT-Folly",
    ].join(" "),
    "OTHER_CFLAGS" => "$(inherited) -isystem $(PODS_TARGET_SRCROOT)/vendor/ios/libmpv-device/include",
    "SWIFT_INCLUDE_PATHS[sdk=iphoneos*]"         => "$(inherited) $(PODS_TARGET_SRCROOT)/vendor/ios/libmpv-device/include",
    "SWIFT_INCLUDE_PATHS[sdk=iphonesimulator*]"  => "$(inherited) $(PODS_TARGET_SRCROOT)/vendor/ios/libmpv-simulator/include",
    # LIBRARY_SEARCH_PATHS + OTHER_LDFLAGS for libmpv-apple are set via
    # s.xcconfig below (not pod_target_xcconfig) so they propagate to the
    # consuming app target where the actual linking happens.
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) FOLLY_NO_CONFIG FOLLY_CFG_NO_COROUTINES",
    "OTHER_CPLUSPLUSFLAGS"         => "$(inherited) -DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1",
  }

  # System frameworks libmpv + ffmpeg + libplacebo + MoltenVK + libass
  # pull in transitively. Notable changes vs the MPVKit-era list:
  #   - OpenGLES dropped (the new render path is Vulkan-on-Metal via
  #     MoltenVK; see Phase 0c MPV_RENDER_API_TYPE_VK in render_vk.h).
  #   - Metal + MetalKit + IOSurface + IOKit added (MoltenVK link-time
  #     dependencies as recorded in our synthesized vulkan.pc).
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
    "MetalKit",
    "IOSurface",
    "Security",
    "UIKit",
  ]
  s.libraries = ["iconv", "c++", "z", "bz2", "xml2"]

  # ── Propagate libmpv-apple linker flags to the consuming app ──────────
  # s.xcconfig (aka user_target_xcconfig) applies to targets that DEPEND
  # on this pod — i.e. the main Jellyfuse app binary. Without this, the
  # app's linker can't find -lmpv -lavcodec etc. because pod_target_xcconfig
  # only affects OUR pod's intermediate .a build, not the final link step.
  # s.xcconfig uses paths relative to PODS_ROOT (the Pods dir in the app's
  # ios/ directory). PODS_TARGET_SRCROOT is only defined in
  # pod_target_xcconfig and is blank in the consumer. We derive the path
  # from PODS_ROOT instead.
  libmpv_device_consumer = "#{libmpv_device.sub('$(PODS_TARGET_SRCROOT)', '$(PODS_ROOT)/../../../../modules/native-mpv')}"
  libmpv_sim_consumer    = "#{libmpv_sim.sub('$(PODS_TARGET_SRCROOT)', '$(PODS_ROOT)/../../../../modules/native-mpv')}"
  s.xcconfig = {
    "LIBRARY_SEARCH_PATHS[sdk=iphoneos*]"        => "$(inherited) " + libmpv_device_consumer,
    "LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]" => "$(inherited) " + libmpv_sim_consumer,
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
  # HybridMpvVideoView.view). UIView is an Objective-C type — pure C++
  # can't parse UIKit headers. Compiling all .cpp as ObjC++ lets the
  # bridge resolve UIKit types correctly.
  xcconfig = s.attributes_hash["pod_target_xcconfig"] || {}
  xcconfig["GCC_INPUT_FILETYPE"] = "sourcecode.cpp.objcpp"
  s.pod_target_xcconfig = xcconfig
end
