#!/usr/bin/env bash
# fetch-libmpv.sh — populate vendor/ios/libmpv-{device,simulator} from the
# mpv-apple fork's XCFrameworks.
#
# Two source modes:
#
#   1. RELEASE (default) — download the pinned release zips from
#      https://github.com/${MPV_APPLE_REPO}/releases/download/<tag>/.
#      No local fork build required, suitable for CI and fresh dev
#      machines. The version is pinned by MPV_APPLE_RELEASE_VERSION
#      (defaults to the value baked into this script).
#
#   2. LOCAL DEV — set MPV_APPLE_RELEASE_VERSION=local-dev to skip the
#      download and copy directly from a local fork build at
#      ${MPV_APPLE_BUILD_DIR:-~/projects/mpv-apple/build/xcframeworks}.
#      Useful when iterating on the fork itself.
#
# Either way we end up with a per-version cache at
# ~/Library/Caches/jellyfuse/libmpv-apple/<version>/{device,simulator}
# that vendor/ios/libmpv-{device,simulator} symlinks into. Idempotent:
# re-running is a no-op when the cache is already populated.

set -euo pipefail

# Pinned release tag. Bump when we publish a new fork release; the cache
# is keyed on the version so old caches stay around for rollbacks.
DEFAULT_RELEASE_VERSION="apple/v0.41.0-jf.6"
DEFAULT_REPO="OverGlass/mpv"

LIBMPV_VERSION="${MPV_APPLE_RELEASE_VERSION:-${DEFAULT_RELEASE_VERSION}}"
MPV_APPLE_REPO="${MPV_APPLE_REPO:-${DEFAULT_REPO}}"
LOCAL_BUILD="${MPV_APPLE_BUILD_DIR:-${HOME}/projects/mpv-apple/build/xcframeworks}"

CACHE_ROOT="${HOME}/Library/Caches/jellyfuse/libmpv-apple/${LIBMPV_VERSION}"
CACHE_DEVICE="${CACHE_ROOT}/device"
CACHE_SIM="${CACHE_ROOT}/simulator"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENDOR_DEVICE="${MODULE_DIR}/vendor/ios/libmpv-device"
VENDOR_SIM="${MODULE_DIR}/vendor/ios/libmpv-simulator"

# Frameworks the consumer needs to link. Mirrors the apple/main package
# step. Order doesn't matter for fetch; the podspec controls link order.
FRAMEWORKS=(
  "LibMpv"
  "LibAvcodec" "LibAvfilter" "LibAvformat" "LibAvutil"
  "LibSwresample" "LibSwscale" "LibPostproc"
  "LibPlacebo"
  "LibMoltenVK"
  "LibGlslang_combined"
  "LibAss" "LibFreetype" "LibFribidi" "LibHarfbuzz" "LibUnibreak"
  "LibLcms2"
)

# Map framework name -> static archive base name (lowercased, "lib" prefixed
# for the autotools-style files we vendor).
archive_name() {
  local fw="$1"
  local lower
  lower="$(echo "$fw" | sed 's/^Lib//' | tr '[:upper:]' '[:lower:]')"
  echo "lib${lower}.a"
}

# ── cache hit? ────────────────────────────────────────────────────────────────

cache_complete() {
  local dir="$1"
  [[ -f "${dir}/.complete" ]] && [[ -f "${dir}/libmpv.a" ]]
}

if cache_complete "${CACHE_DEVICE}" && cache_complete "${CACHE_SIM}"; then
  echo "libmpv-apple ${LIBMPV_VERSION} already cached at ${CACHE_ROOT}"
else
  # In RELEASE mode, materialize a download dir that looks like a local
  # fork build (one .xcframework per framework) so the rest of the flow
  # can stay shared with LOCAL DEV.
  if [[ "${LIBMPV_VERSION}" != "local-dev" ]]; then
    DOWNLOAD_DIR="${CACHE_ROOT}/_download"
    # URL-encode the slash in the tag for the GitHub release URL.
    URL_TAG="${LIBMPV_VERSION//\//%2F}"
    BASE_URL="https://github.com/${MPV_APPLE_REPO}/releases/download/${URL_TAG}"

    if [[ ! -d "${DOWNLOAD_DIR}" ]] || [[ ! -f "${DOWNLOAD_DIR}/.complete" ]]; then
      echo "Downloading libmpv-apple ${LIBMPV_VERSION} from ${MPV_APPLE_REPO}..."
      rm -rf "${DOWNLOAD_DIR}"
      mkdir -p "${DOWNLOAD_DIR}"

      for FW in "${FRAMEWORKS[@]}"; do
        ZIP="${DOWNLOAD_DIR}/${FW}.xcframework.zip"
        echo "  fetch ${FW}.xcframework.zip"
        curl --fail --location --silent --show-error \
          --output "${ZIP}" \
          "${BASE_URL}/${FW}.xcframework.zip"
        (cd "${DOWNLOAD_DIR}" && unzip -q "${FW}.xcframework.zip")
        rm "${ZIP}"
      done

      curl --fail --location --silent --show-error \
        --output "${DOWNLOAD_DIR}/MANIFEST.json" \
        "${BASE_URL}/MANIFEST.json"

      touch "${DOWNLOAD_DIR}/.complete"
    fi

    LOCAL_BUILD="${DOWNLOAD_DIR}"
  fi

  if [[ ! -d "${LOCAL_BUILD}" ]]; then
    echo "ERROR: local fork build not found at ${LOCAL_BUILD}"
    echo "  Build it first:"
    echo "    cd ~/projects/mpv-apple && ./apple/scripts/build.sh --slice ios-arm64"
    echo "    cd ~/projects/mpv-apple && ./apple/scripts/build.sh --slice ios-arm64_x86_64-simulator"
    echo "  Then re-run this script."
    exit 1
  fi

  echo "Populating libmpv-apple ${LIBMPV_VERSION} cache from ${LOCAL_BUILD}..."
  rm -rf "${CACHE_DEVICE}" "${CACHE_SIM}"
  mkdir -p "${CACHE_DEVICE}/include" "${CACHE_SIM}/include"

  for FW in "${FRAMEWORKS[@]}"; do
    XCF="${LOCAL_BUILD}/${FW}.xcframework"
    if [[ ! -d "${XCF}" ]]; then
      echo "ERROR: missing ${XCF}"
      echo "  The fork build is incomplete. Re-run apple/scripts/build.sh."
      exit 1
    fi

    AR_NAME="$(archive_name "${FW}")"

    # Device slice: ios-arm64 (and arm64e if present)
    for SLICE_DIR in "${XCF}/ios-arm64" "${XCF}/ios-arm64_arm64e"; do
      [[ -d "${SLICE_DIR}" ]] || continue
      cp "${SLICE_DIR}/${FW}.framework/${FW}" "${CACHE_DEVICE}/${AR_NAME}"
      if [[ -d "${SLICE_DIR}/${FW}.framework/Headers" ]]; then
        cp -R "${SLICE_DIR}/${FW}.framework/Headers/." "${CACHE_DEVICE}/include/" 2>/dev/null || true
      fi
      break
    done

    # Simulator slice: ios-arm64-simulator or ios-arm64_x86_64-simulator
    for SLICE_DIR in "${XCF}/ios-arm64_x86_64-simulator" "${XCF}/ios-arm64-simulator"; do
      [[ -d "${SLICE_DIR}" ]] || continue
      cp "${SLICE_DIR}/${FW}.framework/${FW}" "${CACHE_SIM}/${AR_NAME}"
      if [[ -d "${SLICE_DIR}/${FW}.framework/Headers" ]]; then
        cp -R "${SLICE_DIR}/${FW}.framework/Headers/." "${CACHE_SIM}/include/" 2>/dev/null || true
      fi
      break
    done
  done

  # Sanitize headers — keep mpv/, vulkan/, vk_video/, MoltenVK/, exclude
  # everything else (FFmpeg / libplacebo / libass / etc. headers would
  # either shadow system headers like <time.h> or aren't needed by Swift
  # consumers). render_vk.h #include <vulkan/vulkan_core.h>, so vulkan/
  # MUST be on the include path or the Swift module fails to build.
  KEEP_DIRS=("mpv" "vulkan" "vk_video" "MoltenVK")
  for DIR in "${CACHE_DEVICE}/include" "${CACHE_SIM}/include"; do
    KEEP="$(mktemp -d)"
    for SUB in "${KEEP_DIRS[@]}"; do
      [[ -d "${DIR}/${SUB}" ]] && cp -R "${DIR}/${SUB}" "${KEEP}/${SUB}"
    done
    rm -rf "${DIR:?}"
    mkdir -p "${DIR}"
    for SUB in "${KEEP_DIRS[@]}"; do
      [[ -d "${KEEP}/${SUB}" ]] && mv "${KEEP}/${SUB}" "${DIR}/${SUB}"
    done
    rm -rf "${KEEP}"
  done

  # Swift modulemap. Two modules:
  #   Libmpv: the public mpv API. Includes our Phase 0c render_vk.h so
  #           consumers can `import Libmpv` and reference
  #           mpv_vulkan_init_params / mpv_vulkan_target_image. render_vk.h
  #           transitively #include <vulkan/vulkan_core.h>, which resolves
  #           against the vulkan/ headers shipped alongside.
  #   Vulkan: the raw Vulkan headers, exported for Phase 1 consumer code
  #           that creates VkInstance/VkDevice via MoltenVK.
  for DIR in "${CACHE_DEVICE}/include" "${CACHE_SIM}/include"; do
    cat > "${DIR}/module.modulemap" <<'MODMAP'
module Libmpv [system] {
    header "mpv/client.h"
    header "mpv/render.h"
    header "mpv/render_gl.h"
    header "mpv/render_vk.h"
    header "mpv/render_libmpv_apple.h"
    header "mpv/stream_cb.h"
    export *
}

module Vulkan [system] {
    umbrella header "vulkan/vulkan.h"
    // vulkan/vulkan.h gates vulkan_metal.h behind VK_USE_PLATFORM_METAL_EXT,
    // which the modulemap can't define. List it explicitly so consumers can
    // use VK_EXT_metal_objects (IOSurface ↔ VkImage import) — required by
    // the Phase 1 render path.
    header "vulkan/vulkan_metal.h"
    export *
}
MODMAP
  done

  touch "${CACHE_DEVICE}/.complete" "${CACHE_SIM}/.complete"
  echo "Cached libmpv-apple ${LIBMPV_VERSION} at ${CACHE_ROOT}"
fi

# ── symlink worktree → cache ─────────────────────────────────────────────────

mkdir -p "${MODULE_DIR}/vendor/ios"
rm -rf "${VENDOR_DEVICE}" "${VENDOR_SIM}"
ln -s "${CACHE_DEVICE}" "${VENDOR_DEVICE}"
ln -s "${CACHE_SIM}" "${VENDOR_SIM}"

echo "Done: modules/native-mpv/vendor/ios/libmpv-{device,simulator} → ${CACHE_ROOT}"
echo "      (libmpv-apple ${LIBMPV_VERSION})"
