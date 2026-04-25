#!/usr/bin/env bash
# Fail if the App Store icon has an alpha channel — Apple rejects those.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICON="$SCRIPT_DIR/../assets/images/icon.png"
if [ ! -f "$ICON" ]; then
  echo "icon-check: $ICON not found" >&2
  exit 1
fi
HAS_ALPHA=$(sips -g hasAlpha "$ICON" 2>/dev/null | awk '/hasAlpha/ {print $2}')
W=$(sips -g pixelWidth "$ICON" 2>/dev/null | awk '/pixelWidth/ {print $2}')
H=$(sips -g pixelHeight "$ICON" 2>/dev/null | awk '/pixelHeight/ {print $2}')
if [ "$HAS_ALPHA" != "no" ] || [ "$W" != "1024" ] || [ "$H" != "1024" ]; then
  echo "icon-check: $ICON must be 1024x1024 with no alpha (got ${W}x${H}, hasAlpha=${HAS_ALPHA})" >&2
  echo "  fix: bun run --filter @jellyfuse/mobile assets:icon-generate" >&2
  exit 1
fi
echo "icon-check: 1024x1024 opaque OK"
