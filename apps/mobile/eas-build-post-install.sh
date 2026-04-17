#!/usr/bin/env bash
# EAS Build hook: runs after `bun install`, before `expo prebuild`.
# Fetches the native libmpv artifacts for whichever platform is being
# built. EAS sets `$EAS_BUILD_PLATFORM` (ios | android).
set -euo pipefail

PLATFORM="${EAS_BUILD_PLATFORM:-${1:-}}"

case "${PLATFORM}" in
  ios)
    echo "==> Fetching MPVKit iOS static libs..."
    bash ../../modules/native-mpv/scripts/fetch-mpvkit.sh
    echo "==> MPVKit ready."
    ;;
  android)
    echo "==> Fetching libmpv-android from 1Password..."
    bash ../../modules/native-mpv/scripts/fetch-libmpv-android.sh
    echo "==> libmpv-android ready."
    ;;
  "")
    echo "EAS_BUILD_PLATFORM not set; fetching both platforms."
    bash ../../modules/native-mpv/scripts/fetch-mpvkit.sh
    bash ../../modules/native-mpv/scripts/fetch-libmpv-android.sh
    ;;
  *)
    echo "error: unknown platform '${PLATFORM}'" >&2
    exit 1
    ;;
esac
