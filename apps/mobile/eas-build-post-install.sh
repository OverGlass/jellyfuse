#!/usr/bin/env bash
# EAS Build hook: runs after `bun install`, before `expo prebuild`.
# Fetches MPVKit static libs so the NativeMpv pod can link.
set -euo pipefail

echo "==> Fetching MPVKit iOS static libs..."
bash ../../modules/native-mpv/scripts/fetch-mpvkit.sh
echo "==> MPVKit ready."
