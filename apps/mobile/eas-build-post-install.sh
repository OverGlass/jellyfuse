#!/usr/bin/env bash
# EAS Build hook: runs after `bun install`, before `expo prebuild`.
# Fetches libmpv-apple static libs so the NativeMpv pod can link.
#
# libmpv-apple is the Jellyfuse hard fork of mpv at github.com/<arkbase>/
# mpv-apple. While we're still local-dev (no GH releases yet), the fetch
# script defaults to copying from a sibling clone at ~/projects/mpv-apple.
# CI / EAS will need MPV_APPLE_RELEASE_VERSION + URL set in the
# environment once the fork ships its first tagged release.
set -euo pipefail

echo "==> Fetching libmpv-apple iOS static libs..."
bash ../../modules/native-mpv/scripts/fetch-libmpv.sh
echo "==> libmpv-apple ready."
