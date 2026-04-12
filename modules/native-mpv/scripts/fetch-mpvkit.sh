#!/usr/bin/env bash
# fetch-mpvkit.sh — download + extract MPVKit static archives into
# modules/native-mpv/vendor/ios/mpvkit-{device,simulator}.
#
# Port of crates/jf-module-player's `make fetch-mpvkit-ios` target
# from the Rust reference app, pinned to the same MPVKIT_VERSION so
# the Jellyfuse iOS build uses the exact same libmpv + FFmpeg + codec
# matrix the Rust client has been running in production.
#
# Shared cache at ~/Library/Caches/jellyfuse/mpvkit-ios/$VERSION so
# multiple worktrees don't each download ~200 MB. Each worktree's
# `vendor/ios/mpvkit-{device,simulator}` becomes a symlink into the
# cache after this script runs.
#
# Idempotent: re-running with the cache populated just re-links the
# symlinks. Bumping MPVKIT_VERSION auto-invalidates.

set -euo pipefail

MPVKIT_VERSION="${MPVKIT_VERSION:-0.41.0}"
MPVKIT_BASE="https://github.com/mpvkit/MPVKit/releases/download/${MPVKIT_VERSION}"
CACHE_ROOT="${HOME}/Library/Caches/jellyfuse/mpvkit-ios/${MPVKIT_VERSION}"
CACHE_DEVICE="${CACHE_ROOT}/device"
CACHE_SIM="${CACHE_ROOT}/simulator"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENDOR_DEVICE="${MODULE_DIR}/vendor/ios/mpvkit-device"
VENDOR_SIM="${MODULE_DIR}/vendor/ios/mpvkit-simulator"

# Non-GPL build: Libmpv + 7 FFmpeg libs + 20 shared deps = 28 XCFrameworks.
# Version pins match the Rust `make fetch-mpvkit-ios` target — bump there
# first if any of them need updating.
XCFRAMEWORKS=(
  "${MPVKIT_BASE}/Libmpv.xcframework.zip"
  "${MPVKIT_BASE}/Libavcodec.xcframework.zip"
  "${MPVKIT_BASE}/Libavdevice.xcframework.zip"
  "${MPVKIT_BASE}/Libavformat.xcframework.zip"
  "${MPVKIT_BASE}/Libavfilter.xcframework.zip"
  "${MPVKIT_BASE}/Libavutil.xcframework.zip"
  "${MPVKIT_BASE}/Libswresample.xcframework.zip"
  "${MPVKIT_BASE}/Libswscale.xcframework.zip"
  "https://github.com/mpvkit/openssl-build/releases/download/3.3.5/Libcrypto.xcframework.zip"
  "https://github.com/mpvkit/openssl-build/releases/download/3.3.5/Libssl.xcframework.zip"
  "https://github.com/mpvkit/gnutls-build/releases/download/3.8.11/gmp.xcframework.zip"
  "https://github.com/mpvkit/gnutls-build/releases/download/3.8.11/nettle.xcframework.zip"
  "https://github.com/mpvkit/gnutls-build/releases/download/3.8.11/hogweed.xcframework.zip"
  "https://github.com/mpvkit/gnutls-build/releases/download/3.8.11/gnutls.xcframework.zip"
  "https://github.com/mpvkit/libass-build/releases/download/0.17.4/Libunibreak.xcframework.zip"
  "https://github.com/mpvkit/libass-build/releases/download/0.17.4/Libfreetype.xcframework.zip"
  "https://github.com/mpvkit/libass-build/releases/download/0.17.4/Libfribidi.xcframework.zip"
  "https://github.com/mpvkit/libass-build/releases/download/0.17.4/Libharfbuzz.xcframework.zip"
  "https://github.com/mpvkit/libass-build/releases/download/0.17.4/Libass.xcframework.zip"
  "https://github.com/mpvkit/libsmbclient-build/releases/download/4.15.13-2512/Libsmbclient.xcframework.zip"
  "https://github.com/mpvkit/libbluray-build/releases/download/1.4.0/Libbluray.xcframework.zip"
  "https://github.com/mpvkit/libuavs3d-build/releases/download/1.2.1-xcode/Libuavs3d.xcframework.zip"
  "https://github.com/mpvkit/libdovi-build/releases/download/3.3.2/Libdovi.xcframework.zip"
  "https://github.com/mpvkit/moltenvk-build/releases/download/1.4.1/MoltenVK.xcframework.zip"
  "https://github.com/mpvkit/libshaderc-build/releases/download/2025.5.0/Libshaderc_combined.xcframework.zip"
  "https://github.com/mpvkit/lcms2-build/releases/download/2.17.0/lcms2.xcframework.zip"
  "https://github.com/mpvkit/libplacebo-build/releases/download/7.351.0-2512/Libplacebo.xcframework.zip"
  "https://github.com/mpvkit/libdav1d-build/releases/download/1.5.2-xcode/Libdav1d.xcframework.zip"
  "https://github.com/mpvkit/libuchardet-build/releases/download/0.0.8-xcode/Libuchardet.xcframework.zip"
  "https://github.com/mpvkit/libluajit-build/releases/download/2.1.0-xcode/Libluajit.xcframework.zip"
)

# ── cache hit? ────────────────────────────────────────────────────────────────

if [[ -f "${CACHE_DEVICE}/libmpv.a" && -f "${CACHE_SIM}/libmpv.a" && -f "${CACHE_DEVICE}/.complete" ]]; then
  echo "MPVKit ${MPVKIT_VERSION} already cached at ${CACHE_ROOT}"
else
  echo "Downloading MPVKit ${MPVKIT_VERSION} to shared cache ${CACHE_ROOT}..."
  rm -rf "${CACHE_DEVICE}" "${CACHE_SIM}"
  mkdir -p "${CACHE_DEVICE}/include" "${CACHE_SIM}/include"
  TMP="$(mktemp -d)"
  trap 'rm -rf "${TMP}"' EXIT

  for URL in "${XCFRAMEWORKS[@]}"; do
    NAME="$(basename "${URL}" .zip)"
    echo "  • ${NAME}"
    curl -fsSL --retry 3 --retry-delay 2 -o "${TMP}/${NAME}.zip" "${URL}"
    unzip -qo "${TMP}/${NAME}.zip" -d "${TMP}"
    rm "${TMP}/${NAME}.zip"
    FW_NAME="${NAME%.xcframework}"

    # ── device slice (arm64) ──────────────────────────────────────────────
    for SLICE_DIR in "${TMP}/${NAME}/ios-arm64" "${TMP}/${NAME}/ios-arm64_arm64e"; do
      [[ -d "${SLICE_DIR}" ]] || continue
      BIN="${SLICE_DIR}/${FW_NAME}.framework/${FW_NAME}"
      if [[ ! -f "${BIN}" ]]; then
        BIN="$(find "${SLICE_DIR}" \( -name '*.a' -o -name "${FW_NAME}" \) 2>/dev/null | head -1)"
      fi
      [[ -f "${BIN}" ]] || continue
      LOWER="$(echo "${FW_NAME}" | tr '[:upper:]' '[:lower:]' | sed 's/^lib//')"
      cp "${BIN}" "${CACHE_DEVICE}/lib${LOWER}.a"
      # Copy headers + modulemap from the framework (Libmpv has mpv/*.h)
      HEADERS="${SLICE_DIR}/${FW_NAME}.framework/Headers"
      MODULEMAP="${SLICE_DIR}/${FW_NAME}.framework/Modules/module.modulemap"
      if [[ -d "${HEADERS}" ]]; then
        cp -R "${HEADERS}"/* "${CACHE_DEVICE}/include/" 2>/dev/null || true
      fi
      if [[ -f "${MODULEMAP}" ]]; then
        mkdir -p "${CACHE_DEVICE}/include"
        cp "${MODULEMAP}" "${CACHE_DEVICE}/include/${FW_NAME}.modulemap" 2>/dev/null || true
      fi
      break
    done

    # ── simulator slice (arm64 or universal) ──────────────────────────────
    for SLICE_DIR in "${TMP}/${NAME}/ios-arm64_x86_64-simulator" "${TMP}/${NAME}/ios-arm64-simulator"; do
      [[ -d "${SLICE_DIR}" ]] || continue
      BIN="${SLICE_DIR}/${FW_NAME}.framework/${FW_NAME}"
      if [[ ! -f "${BIN}" ]]; then
        BIN="$(find "${SLICE_DIR}" \( -name '*.a' -o -name "${FW_NAME}" \) 2>/dev/null | head -1)"
      fi
      [[ -f "${BIN}" ]] || continue
      LOWER="$(echo "${FW_NAME}" | tr '[:upper:]' '[:lower:]' | sed 's/^lib//')"
      cp "${BIN}" "${CACHE_SIM}/lib${LOWER}.a"
      HEADERS="${SLICE_DIR}/${FW_NAME}.framework/Headers"
      MODULEMAP="${SLICE_DIR}/${FW_NAME}.framework/Modules/module.modulemap"
      if [[ -d "${HEADERS}" ]]; then
        cp -R "${HEADERS}"/* "${CACHE_SIM}/include/" 2>/dev/null || true
      fi
      if [[ -f "${MODULEMAP}" ]]; then
        mkdir -p "${CACHE_SIM}/include"
        cp "${MODULEMAP}" "${CACHE_SIM}/include/${FW_NAME}.modulemap" 2>/dev/null || true
      fi
      break
    done

    rm -rf "${TMP}/${NAME}"
  done

  # ── thin universal binaries to plain arm64 so CocoaPods is happy ─────────
  echo "Thinning archives to plain arm64 ar..."
  for F in "${CACHE_DEVICE}"/*.a "${CACHE_SIM}"/*.a; do
    [[ -f "${F}" ]] || continue
    if file "${F}" | grep -q "universal binary"; then
      lipo "${F}" -thin arm64 -output "${F}.thin" && mv "${F}.thin" "${F}"
    fi
  done

  # ── write a Swift-compatible modulemap for `import Libmpv` ────────────
  # Placed in the include dir so header paths resolve relative to the
  # modulemap file (Xcode's rule). SWIFT_INCLUDE_PATHS in the podspec
  # points at this directory.
  for DIR in "${CACHE_DEVICE}/include" "${CACHE_SIM}/include"; do
    cat > "${DIR}/module.modulemap" <<'MODMAP'
module Libmpv [system] {
    header "mpv/client.h"
    header "mpv/render.h"
    header "mpv/render_gl.h"
    header "mpv/stream_cb.h"
    export *
}
MODMAP
  done

  touch "${CACHE_DEVICE}/.complete" "${CACHE_SIM}/.complete"
  echo "Cached MPVKit ${MPVKIT_VERSION} at ${CACHE_ROOT}"
fi

# ── symlink worktree → cache ─────────────────────────────────────────────────

echo "Linking vendor/ios/mpvkit-{device,simulator} → ${CACHE_ROOT}/..."
mkdir -p "${MODULE_DIR}/vendor/ios"
rm -rf "${VENDOR_DEVICE}" "${VENDOR_SIM}"
ln -s "${CACHE_DEVICE}" "${VENDOR_DEVICE}"
ln -s "${CACHE_SIM}" "${VENDOR_SIM}"

echo "Done: modules/native-mpv/vendor/ios/mpvkit-{device,simulator} → ${CACHE_ROOT}"
echo "      (MPVKit ${MPVKIT_VERSION})"
