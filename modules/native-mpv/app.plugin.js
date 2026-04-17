// Expo config plugin for @jellyfuse/native-mpv.
//
// Two Android-specific concerns handled here:
//  1. NDK pin — libmpv-android vendored binaries (Phase C) are built
//     against NDK r26b. Any other NDK risks ABI/symbol mismatches.
//  2. ABI narrowing — Jellyfuse is phone-only on Android. Shipping
//     arm64-v8a (physical devices) + x86_64 (emulators) cuts APK size
//     roughly in half vs the RN default (armeabi-v7a, x86, x86_64,
//     arm64-v8a) and halves the work in `fetch-libmpv-android.sh`.
//
// iOS is a no-op — MPVKit pods are wired via the NativeMpv.podspec.

const { withGradleProperties } = require("@expo/config-plugins");

const NDK_VERSION = "26.1.10909125";
const ABIS = "arm64-v8a,x86_64";

function upsertProp(config, key, value) {
  const props = config.modResults;
  const existing = props.find((p) => p.type === "property" && p.key === key);
  if (existing) {
    existing.value = value;
  } else {
    props.push({ type: "property", key, value });
  }
}

const withNativeMpvAndroid = (config) => {
  return withGradleProperties(config, (cfg) => {
    upsertProp(cfg, "android.ndkVersion", NDK_VERSION);
    upsertProp(cfg, "reactNativeArchitectures", ABIS);
    return cfg;
  });
};

module.exports = withNativeMpvAndroid;
