#!/usr/bin/env bash
# build-libmpv-android.sh — one-shot builder for the vendored
# libmpv-android binary. Runs the upstream `mpv-android/buildscripts`
# Docker image with `--no-gpl` and `--disable-smb --disable-bluray`
# (Jellyfuse only ever streams HTTP(S) from a Jellyfin server, so
# SMB/Bluray would just be unused GPL-licensed dead weight).
#
# Output:
#   dist/libmpv-android-<VERSION>.tar.gz
#     arm64-v8a/libmpv.so
#     x86_64/libmpv.so
#     include/mpv/*.h                (client.h, render.h, render_gl.h,
#                                     stream_cb.h)
#     BUILD_INFO                     (upstream SHA + build date)
#
# The tarball is what `fetch-libmpv-android.sh` pulls via `gh release
# download` (CI + dev) or the local shared cache. After this script
# finishes, publish the tarball as a GitHub Release on the jellyfuse
# repo:
#
#   gh release create "libmpv-android-${VERSION}" \
#     --title "libmpv-android ${VERSION}" \
#     --notes "mpv-android buildscripts SHA <sha>, --no-gpl" \
#     dist/libmpv-android-${VERSION}.tar.gz
#
# The release tag name is the source of truth for the version pin —
# it MUST match `MPV_ANDROID_VERSION` in the repo.
#
# Requires Docker (builds inside an Ubuntu container — works on
# macOS / Linux hosts). First run takes ~60-90 min; rebuilds are
# under 10 min thanks to the mpv-android build cache.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

MPV_ANDROID_VERSION="${MPV_ANDROID_VERSION:-$(cat "${MODULE_DIR}/MPV_ANDROID_VERSION")}"
# Pin to a specific mpv-android/buildscripts commit so the artifact is
# bit-for-bit reproducible across developer machines. Bump when
# MPV_ANDROID_VERSION changes.
BUILDSCRIPTS_REF="${BUILDSCRIPTS_REF:-master}"

DIST_DIR="${MODULE_DIR}/dist"
TARBALL="${DIST_DIR}/libmpv-android-${MPV_ANDROID_VERSION}.tar.gz"
WORK_DIR="${WORK_DIR:-${HOME}/.cache/jellyfuse/libmpv-android-build/${MPV_ANDROID_VERSION}}"

ABIS=(arm64-v8a x86_64)
# mpv-android's ABI naming (for `buildall.sh --arch`)
declare -A ARCH_MAP=(
  [arm64-v8a]=arm64
  [x86_64]=x86_64
)

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker is required. Install Docker Desktop (macOS) or docker-ce (Linux)." >&2
  exit 1
fi

mkdir -p "${DIST_DIR}" "${WORK_DIR}"

# ── clone mpv-android/buildscripts ──────────────────────────────────────────
if [[ ! -d "${WORK_DIR}/buildscripts/.git" ]]; then
  echo "==> Cloning mpv-android/buildscripts into ${WORK_DIR}"
  git clone --depth 1 https://github.com/mpv-android/mpv-android.git "${WORK_DIR}/mpv-android"
  ln -sfn "${WORK_DIR}/mpv-android/buildscripts" "${WORK_DIR}/buildscripts"
fi

cd "${WORK_DIR}/mpv-android"
git fetch --depth 1 origin "${BUILDSCRIPTS_REF}"
git checkout FETCH_HEAD
UPSTREAM_SHA="$(git rev-parse HEAD)"

# ── build the Docker image (cache-friendly) ─────────────────────────────────
IMAGE_TAG="jellyfuse-libmpv-android:${MPV_ANDROID_VERSION}"
echo "==> Building Docker image ${IMAGE_TAG}"
docker build --tag "${IMAGE_TAG}" "${WORK_DIR}/mpv-android/buildscripts"

# ── per-ABI build inside the container ──────────────────────────────────────
STAGE_DIR="${WORK_DIR}/stage"
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/include"

for ABI in "${ABIS[@]}"; do
  ARCH="${ARCH_MAP[${ABI}]}"
  echo "==> Building libmpv for ABI=${ABI} (arch=${ARCH})"
  # `--no-gpl` drops SMB + Bluray (GPL). `buildall.sh` invokes mpv's
  # configure with `--enable-libass` by default.
  docker run --rm \
    -v "${WORK_DIR}/mpv-android":/src \
    -v "${STAGE_DIR}":/out \
    -w /src/buildscripts \
    "${IMAGE_TAG}" \
    bash -eu -c "
      ./include/path.sh &&
      ./buildall.sh --no-gpl --arch ${ARCH} clean &&
      ./buildall.sh --no-gpl --arch ${ARCH} &&
      mkdir -p /out/${ABI} &&
      cp prefix/${ARCH}/lib/libmpv.so /out/${ABI}/libmpv.so &&
      if [[ -z \"\$(ls -A /out/include/mpv 2>/dev/null)\" ]]; then
        mkdir -p /out/include/mpv &&
        cp prefix/${ARCH}/include/mpv/*.h /out/include/mpv/;
      fi
    "
done

# ── build-info + tarball ────────────────────────────────────────────────────
cat > "${STAGE_DIR}/BUILD_INFO" <<EOF
mpv_android_version=${MPV_ANDROID_VERSION}
buildscripts_sha=${UPSTREAM_SHA}
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
abis=${ABIS[*]}
flags=--no-gpl
EOF

echo "==> Packaging ${TARBALL}"
tar -czf "${TARBALL}" -C "${STAGE_DIR}" .

echo ""
echo "Done: ${TARBALL}"
echo ""
echo "Next step — publish as a GitHub Release:"
echo "  gh release create \"libmpv-android-${MPV_ANDROID_VERSION}\" \\"
echo "    --title \"libmpv-android ${MPV_ANDROID_VERSION}\" \\"
echo "    --notes \"mpv-android buildscripts SHA ${UPSTREAM_SHA}, --no-gpl\" \\"
echo "    \"${TARBALL}\""
