require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "Downloader"
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

  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => [
      "$(inherited)",
      "${PODS_ROOT}/RCT-Folly",
    ].join(" "),
    "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) FOLLY_NO_CONFIG FOLLY_CFG_NO_COROUTINES",
    "OTHER_CPLUSPLUSFLAGS"         => "$(inherited) -DFOLLY_NO_CONFIG -DFOLLY_MOBILE=1 -DFOLLY_USE_LIBCPP=1",
  }

  s.frameworks = ["Foundation", "UIKit"]

  s.dependency "React-jsi"
  s.dependency "React-callinvoker"

  load "nitrogen/generated/ios/Downloader+autolinking.rb"
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
