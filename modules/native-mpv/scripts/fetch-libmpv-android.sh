#!/usr/bin/env bash
# fetch-libmpv-android.sh — populate vendor/android/ from a GitHub
# Release published by `build-libmpv-android.sh`. Mirrors the iOS
# `fetch-mpvkit.sh` shape (which also pulls from GitHub Releases) so
# CI + local dev use the same entrypoint.
#
# Layout produced (relative to modules/native-mpv/):
#   vendor/android/
#     arm64-v8a/libmpv.so
#     x86_64/libmpv.so
#     include/mpv/{client,render,render_gl,stream_cb}.h
#     BUILD_INFO
#     .complete
#
# Shared cache at `~/.cache/jellyfuse/libmpv-android/<VERSION>` so
# multiple worktrees don't re-download the same ~40 MB tarball.
#
# Source selection (first match wins):
#   1. ${LIBMPV_ANDROID_TARBALL}    — local path, dev escape hatch
#      (set this when iterating on build-libmpv-android.sh output
#      before publishing the release).
#   2. GitHub Release tagged `libmpv-android-${MPV_ANDROID_VERSION}`
#      on ${LIBMPV_GH_REPO} (defaults to OverGlass/jellyfuse). Uses
#      `gh release download` — authenticates via the same login
#      `gh auth status` shows. CI sets GH_TOKEN / GITHUB_TOKEN in
#      env and `gh` picks it up automatically.
#
# Idempotent: cache-hit → just re-symlink vendor/android.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

MPV_ANDROID_VERSION="${MPV_ANDROID_VERSION:-$(cat "${MODULE_DIR}/MPV_ANDROID_VERSION")}"
CACHE_ROOT="${HOME}/.cache/jellyfuse/libmpv-android/${MPV_ANDROID_VERSION}"
VENDOR_DIR="${MODULE_DIR}/vendor/android"
LIBMPV_GH_REPO="${LIBMPV_GH_REPO:-OverGlass/jellyfuse}"
RELEASE_TAG="libmpv-android-${MPV_ANDROID_VERSION}"
ASSET_NAME="libmpv-android-${MPV_ANDROID_VERSION}.tar.gz"

# ── cache hit? ──────────────────────────────────────────────────────────────
if [[ -f "${CACHE_ROOT}/.complete" ]]; then
  echo "libmpv-android ${MPV_ANDROID_VERSION} already cached at ${CACHE_ROOT}"
else
  rm -rf "${CACHE_ROOT}"
  mkdir -p "${CACHE_ROOT}"

  if [[ -n "${LIBMPV_ANDROID_TARBALL:-}" ]]; then
    # Dev escape hatch — point at a local build-libmpv-android.sh output.
    if [[ ! -f "${LIBMPV_ANDROID_TARBALL}" ]]; then
      echo "error: LIBMPV_ANDROID_TARBALL=${LIBMPV_ANDROID_TARBALL} does not exist" >&2
      exit 1
    fi
    echo "==> Extracting ${LIBMPV_ANDROID_TARBALL} → ${CACHE_ROOT}"
    tar -xzf "${LIBMPV_ANDROID_TARBALL}" -C "${CACHE_ROOT}"
  elif command -v gh >/dev/null 2>&1 && gh release view "${RELEASE_TAG}" --repo "${LIBMPV_GH_REPO}" >/dev/null 2>&1; then
    TMP="$(mktemp -d)"
    trap 'rm -rf "${TMP}"' EXIT
    echo "==> Downloading ${ASSET_NAME} from ${LIBMPV_GH_REPO}@${RELEASE_TAG}"
    gh release download "${RELEASE_TAG}" \
      --repo "${LIBMPV_GH_REPO}" \
      --pattern "${ASSET_NAME}" \
      --dir "${TMP}"
    tar -xzf "${TMP}/${ASSET_NAME}" -C "${CACHE_ROOT}"
  else
    # No source available. Phase C.1 accepts this: the CMake layer
    # falls back to stubs-only when vendor/android is missing. The
    # Kotlin JNI bridge checks MpvBridge.isLinked() and surfaces
    # `mpv.not_implemented` so the player screen shows the
    # "Playback Unavailable" overlay.
    cat >&2 <<EOF
warning: libmpv-android ${MPV_ANDROID_VERSION} not available locally or on GitHub.
         Falling back to stubs-only Android build. To get real playback:

           • Build locally:
               bash modules/native-mpv/scripts/build-libmpv-android.sh
             then publish the release:
               gh release create "${RELEASE_TAG}" \\
                 --repo "${LIBMPV_GH_REPO}" \\
                 --title "libmpv-android ${MPV_ANDROID_VERSION}" \\
                 modules/native-mpv/dist/${ASSET_NAME}

           • Or point at an existing tarball:
               LIBMPV_ANDROID_TARBALL=... bash $0

         If gh is installed, check auth with: gh auth status
EOF
    # Leave CACHE_ROOT empty so vendor/android stays absent and
    # CMakeLists takes the stubs-only branch. Exit 0 so Gradle
    # continues.
    rmdir "${CACHE_ROOT}" 2>/dev/null || true
    exit 0
  fi

  # Sanity-check the expected layout — fail loud if the tarball is
  # missing something the JNI layer will try to link against.
  # libmpv links dynamically against ffmpeg (libav*, libsw*); all must
  # be present in jniLibs so System.loadLibrary's dlopen chain resolves.
  for ABI in arm64-v8a x86_64; do
    for SO in libmpv.so libavcodec.so libavformat.so libavutil.so \
              libavfilter.so libavdevice.so libswresample.so libswscale.so; do
      if [[ ! -f "${CACHE_ROOT}/${ABI}/${SO}" ]]; then
        echo "error: ${CACHE_ROOT}/${ABI}/${SO} missing after extract" >&2
        exit 1
      fi
    done
  done
  for H in client.h render.h render_gl.h; do
    if [[ ! -f "${CACHE_ROOT}/include/mpv/${H}" ]]; then
      echo "error: ${CACHE_ROOT}/include/mpv/${H} missing after extract" >&2
      exit 1
    fi
  done

  touch "${CACHE_ROOT}/.complete"
  echo "Cached libmpv-android ${MPV_ANDROID_VERSION} at ${CACHE_ROOT}"
fi

# ── symlink worktree → cache ────────────────────────────────────────────────
mkdir -p "$(dirname "${VENDOR_DIR}")"
rm -rf "${VENDOR_DIR}"
ln -s "${CACHE_ROOT}" "${VENDOR_DIR}"
echo "Linked modules/native-mpv/vendor/android → ${CACHE_ROOT}"
