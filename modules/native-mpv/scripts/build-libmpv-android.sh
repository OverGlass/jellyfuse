#!/usr/bin/env bash
# build-libmpv-android.sh — one-shot builder for the vendored
# libmpv-android binary. Runs the upstream `mpv-android/buildscripts`
# natively on the host (macOS or Linux — Windows/WSL not supported by
# upstream).
#
# We build the `mpv` target (not `mpv-android`) which produces a shared
# libmpv.so without the APK wrapper. The default dep set is ffmpeg +
# libass + lua + libplacebo — none of which are GPL. SMB and Bluray
# support would require pulling extra deps; upstream doesn't ship them
# here, so the artifact is LGPL-only out of the box.
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
#     --notes "mpv-android buildscripts SHA <sha>" \
#     dist/libmpv-android-${VERSION}.tar.gz
#
# The release tag name is the source of truth for the version pin —
# it MUST match `MPV_ANDROID_VERSION` in the repo.
#
# Host requirements:
#   • macOS:  brew install coreutils gnu-sed pkg-config meson ninja nasm
#             (upstream path.sh calls ginstall/gsed directly)
#   • Linux:  coreutils, sed, pkg-config, meson, ninja, nasm, and a
#             recent glibc
#   • ~10 GB free disk in $WORK_DIR (Android SDK + NDK + build artifacts)
#   • First run: ~60-90 min (downloads + full build of ffmpeg/libass/lua
#     /libplacebo + mpv). Rebuilds under 10 min.
#
# Override knobs (env):
#   MPV_ANDROID_VERSION  — version tag (defaults to MPV_ANDROID_VERSION file)
#   BUILDSCRIPTS_REF     — mpv-android git ref (defaults to master)
#   WORK_DIR             — persistent build cache (defaults to
#                          ~/.cache/jellyfuse/libmpv-android-build/<ver>)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

MPV_ANDROID_VERSION="${MPV_ANDROID_VERSION:-$(cat "${MODULE_DIR}/MPV_ANDROID_VERSION")}"
BUILDSCRIPTS_REF="${BUILDSCRIPTS_REF:-master}"

# Pin NDK to r26b (26.1.10909125) to match apps/mobile/android/gradle.properties.
# Upstream mpv-android pins r29 by default, but the React Native app links
# against its own NDK r26 libc++_shared.so at runtime. Building libmpv with
# r29 libc++ produces binaries that reference symbols (e.g. std::from_chars
# for floats) that the r26 libc++_shared.so shipped alongside the app doesn't
# export — the app crashes at startup with `UnsatisfiedLinkError`. Keep in
# sync with the app's ndkVersion.
NDK_VERSION_SHORT="${NDK_VERSION_SHORT:-r26b}"
NDK_VERSION_FULL="${NDK_VERSION_FULL:-26.1.10909125}"

DIST_DIR="${MODULE_DIR}/dist"
TARBALL="${DIST_DIR}/libmpv-android-${MPV_ANDROID_VERSION}.tar.gz"
WORK_DIR="${WORK_DIR:-${HOME}/.cache/jellyfuse/libmpv-android-build/${MPV_ANDROID_VERSION}}"

ABIS=(arm64-v8a x86_64)
# mpv-android's ABI naming (for `buildall.sh --arch`)
declare -A ARCH_MAP=(
  [arm64-v8a]=arm64
  [x86_64]=x86_64
)

# ── host sanity checks ──────────────────────────────────────────────────────
OS_KIND=""
case "$(uname -s)" in
  Darwin) OS_KIND=mac ;;
  Linux)  OS_KIND=linux ;;
  *)
    echo "error: unsupported host $(uname -s). Only macOS and Linux work." >&2
    exit 1
    ;;
esac

missing=()
for bin in git pkg-config meson ninja nasm; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    missing+=("${bin}")
  fi
done
if [[ "${OS_KIND}" == "mac" ]]; then
  # upstream path.sh hardcodes `which ginstall` / `gsed`
  for bin in ginstall gsed; do
    if ! command -v "${bin}" >/dev/null 2>&1; then
      missing+=("${bin}")
    fi
  done
fi
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "error: missing host dependencies: ${missing[*]}" >&2
  if [[ "${OS_KIND}" == "mac" ]]; then
    echo "hint: brew install coreutils gnu-sed pkg-config meson ninja nasm bash" >&2
  else
    echo "hint: apt-get install pkg-config meson ninja-build nasm coreutils" >&2
  fi
  exit 1
fi

# Upstream buildall.sh uses `declare -g` which requires bash 4.2+.
# macOS ships bash 3.2 at /bin/bash, and the upstream shebang is
# `#!/bin/bash -e` — so invoking ./buildall.sh directly fails with
# "declare: -g: invalid option". Find a newer bash on PATH (brew's
# `bash` lands at /opt/homebrew/bin/bash or /usr/local/bin/bash) and
# run the script through it explicitly.
BASH_BIN="$(command -v bash || true)"
if [[ -z "${BASH_BIN}" ]]; then
  echo "error: no bash on PATH" >&2
  exit 1
fi
BASH_MAJOR="$("${BASH_BIN}" -c 'echo "${BASH_VERSINFO[0]}"')"
if [[ "${BASH_MAJOR}" -lt 4 ]]; then
  echo "error: bash ${BASH_MAJOR} at ${BASH_BIN} is too old (need 4.2+ for 'declare -g')" >&2
  if [[ "${OS_KIND}" == "mac" ]]; then
    echo "hint: brew install bash, then rerun from a shell that picks it up first on PATH" >&2
  fi
  exit 1
fi

mkdir -p "${DIST_DIR}" "${WORK_DIR}"

# ── clone mpv-android (buildscripts live under it) ──────────────────────────
SRC_DIR="${WORK_DIR}/mpv-android"
if [[ ! -d "${SRC_DIR}/.git" ]]; then
  echo "==> Cloning mpv-android into ${SRC_DIR}"
  git clone --depth 1 https://github.com/mpv-android/mpv-android.git "${SRC_DIR}"
fi

cd "${SRC_DIR}"
echo "==> Checking out ${BUILDSCRIPTS_REF}"
git fetch --depth 1 origin "${BUILDSCRIPTS_REF}"
git checkout FETCH_HEAD
UPSTREAM_SHA="$(git rev-parse HEAD)"

BUILDSCRIPTS_DIR="${SRC_DIR}/buildscripts"

# Pin NDK version in depinfo.sh. Idempotent — re-runs just rewrite the
# same two lines. Use python to avoid sed portability issues (BSD/GNU).
echo "==> Pinning NDK to ${NDK_VERSION_SHORT} (${NDK_VERSION_FULL}) in depinfo.sh"
python3 - "${BUILDSCRIPTS_DIR}/include/depinfo.sh" "${NDK_VERSION_SHORT}" "${NDK_VERSION_FULL}" <<'PY'
import re, sys
path, short, full = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    content = f.read()
content = re.sub(r"^v_ndk=.*$", f"v_ndk={short}", content, flags=re.M)
content = re.sub(r"^v_ndk_n=.*$", f"v_ndk_n={full}", content, flags=re.M)
with open(path, "w") as f:
    f.write(content)
PY

# Disable AAudio output in mpv. Upstream mpv references
# AAUDIO_FORMAT_IEC61937 which only exists in NDK r27+ headers. Since
# we're pinned to r26b (to match the RN app's libc++_shared.so ABI),
# the AAudio backend won't compile. OpenSL ES is still built and is
# the pre-AAudio default Android audio output driver.
echo "==> Patching mpv.sh to pass -Daaudio=disabled"
python3 - "${BUILDSCRIPTS_DIR}/scripts/mpv.sh" <<'PY'
import re, sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
if "-Daaudio=disabled" not in content:
    content = content.replace(
        "-Dlibmpv=true -Dcplayer=false",
        "-Dlibmpv=true -Dcplayer=false -Daaudio=disabled",
    )
    with open(path, "w") as f:
        f.write(content)
PY

# ── download Android SDK / NDK + source tarballs ────────────────────────────
cd "${BUILDSCRIPTS_DIR}"
if [[ ! -d "${BUILDSCRIPTS_DIR}/sdk" ]]; then
  echo "==> Running download.sh (installs Android SDK+NDK into ${BUILDSCRIPTS_DIR}/sdk, ~5 GB)"
  "${BASH_BIN}" -e ./download.sh
else
  echo "==> SDK/NDK already downloaded (${BUILDSCRIPTS_DIR}/sdk)"
fi

# ── per-ABI build ───────────────────────────────────────────────────────────
STAGE_DIR="${WORK_DIR}/stage"
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/include"

for ABI in "${ABIS[@]}"; do
  ARCH="${ARCH_MAP[${ABI}]}"
  echo ""
  echo "==> Building libmpv for ABI=${ABI} (arch=${ARCH})"
  # Build just the `mpv` target → produces shared libmpv.so installed
  # into prefix/${ARCH}/{lib,include}. Skips the mpv-android APK step.
  # Invoke via ${BASH_BIN} to bypass upstream's `/bin/bash` shebang
  # (macOS bash 3.2 can't handle `declare -g`).
  "${BASH_BIN}" -e ./buildall.sh --arch "${ARCH}" mpv

  LIB_DIR="${BUILDSCRIPTS_DIR}/prefix/${ARCH}/lib"
  HDR_SRC="${BUILDSCRIPTS_DIR}/prefix/${ARCH}/include/mpv"

  if [[ ! -f "${LIB_DIR}/libmpv.so" ]]; then
    echo "error: expected ${LIB_DIR}/libmpv.so after build, not found" >&2
    exit 1
  fi
  if [[ ! -d "${HDR_SRC}" ]]; then
    echo "error: expected ${HDR_SRC} after build, not found" >&2
    exit 1
  fi

  mkdir -p "${STAGE_DIR}/${ABI}"
  # libmpv.so links dynamically against the ffmpeg shared libs (libav*,
  # libsw*) built alongside it. Ship all of them — Android's
  # System.loadLibrary resolves transitive dlopen deps from jniLibs.
  for SO in libmpv.so libavcodec.so libavformat.so libavutil.so \
            libavfilter.so libavdevice.so libswresample.so libswscale.so; do
    if [[ ! -f "${LIB_DIR}/${SO}" ]]; then
      echo "error: ${LIB_DIR}/${SO} missing after build" >&2
      exit 1
    fi
    cp "${LIB_DIR}/${SO}" "${STAGE_DIR}/${ABI}/${SO}"
  done

  # Headers are identical across ABIs — copy once on the first pass.
  if [[ -z "$(ls -A "${STAGE_DIR}/include" 2>/dev/null)" ]]; then
    mkdir -p "${STAGE_DIR}/include/mpv"
    cp "${HDR_SRC}"/*.h "${STAGE_DIR}/include/mpv/"
  fi
done

# ── build-info + tarball ────────────────────────────────────────────────────
cat > "${STAGE_DIR}/BUILD_INFO" <<EOF
mpv_android_version=${MPV_ANDROID_VERSION}
buildscripts_sha=${UPSTREAM_SHA}
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
abis=${ABIS[*]}
host=${OS_KIND}
target=mpv (libmpv shared, no APK)
deps=ffmpeg libass lua libplacebo
EOF

echo ""
echo "==> Packaging ${TARBALL}"
tar -czf "${TARBALL}" -C "${STAGE_DIR}" .

echo ""
echo "Done: ${TARBALL}"
echo ""
echo "Next step — publish as a GitHub Release:"
echo "  gh release create \"libmpv-android-${MPV_ANDROID_VERSION}\" \\"
echo "    --title \"libmpv-android ${MPV_ANDROID_VERSION}\" \\"
echo "    --notes \"mpv-android buildscripts SHA ${UPSTREAM_SHA}\" \\"
echo "    \"${TARBALL}\""
