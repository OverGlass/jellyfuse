#!/usr/bin/env bash
# fetch-libmpv.sh — populate vendor/ios/libmpv-{device,simulator} from the
# mpv-apple fork's XCFrameworks.
#
# Replaces fetch-mpvkit.sh. The fork is maintained at ~/projects/mpv-apple
# (or wherever MPV_APPLE_BUILD_DIR points). Until we have GH releases set
# up, this script defaults to copying directly from a local fork build:
#
#   ~/projects/mpv-apple/build/xcframeworks/
#       LibMpv.xcframework/
#         ios-arm64/LibMpv.framework/{LibMpv, Headers, Modules, Info.plist}
#         ios-arm64-simulator/LibMpv.framework/{...}
#       LibAvcodec.xcframework/...
#       (15 frameworks total)
#
# We extract the static archive + headers per slice into a cache dir, then
# symlink vendor/ios/libmpv-{device,simulator} into it. Idempotent: re-run
# is a no-op when the cache is up to date.
#
# Future: when the fork starts shipping GH releases, set
#   MPV_APPLE_RELEASE_VERSION=apple/v0.41.0-jf.1
# and we'll download MANIFEST.json + per-framework .zips, verify SHA256,
# and populate the cache from those.

set -euo pipefail

LIBMPV_VERSION="${MPV_APPLE_RELEASE_VERSION:-local-dev}"
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
