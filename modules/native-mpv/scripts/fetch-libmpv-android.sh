#!/usr/bin/env bash
# fetch-libmpv-android.sh — Phase A stub.
#
# In Phase C this will fetch the non-GPL libmpv-android build and
# extract per-ABI `.so` files + headers into
# `modules/native-mpv/vendor/android/<abi>/`. See the project plan at
# `.claude/plans/rippling-squishing-harbor.md` for the chosen binary
# source (mpv-android `buildall.sh --no-gpl`).
#
# For Phase A this is a no-op so EAS + local builds don't fail. The
# Kotlin stubs throw `mpv.not_implemented` without ever dlopen'ing
# libmpv.so.

set -euo pipefail

MPV_ANDROID_VERSION="${MPV_ANDROID_VERSION:-unpinned}"
echo "fetch-libmpv-android.sh: Phase A stub (no-op). Pin version=${MPV_ANDROID_VERSION} will be honored in Phase C."
exit 0
