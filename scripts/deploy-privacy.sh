#!/usr/bin/env bash
# Push docs/privacy.md to the self-hosted privacy service exposed via
# Tailscale Funnel at https://jellyfuse-privacy.tailba6a9d.ts.net/privacy.html.
#
# Configure the SSH target via env (op:// references in .env.tpl):
#   JELLYFUSE_PRIVACY_HOST   e.g. user@jellyfuse-privacy
#   JELLYFUSE_PRIVACY_PATH   absolute path to the directory the homelab serves
#                            from (the homelab repo's privacy service decides
#                            this — typically /srv/jellyfuse-privacy)
#
# Run as: op run --env-file=.env.tpl -- bun run privacy:deploy
set -euo pipefail

: "${JELLYFUSE_PRIVACY_HOST:?set JELLYFUSE_PRIVACY_HOST in your .env}"
: "${JELLYFUSE_PRIVACY_PATH:?set JELLYFUSE_PRIVACY_PATH in your .env}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$REPO_ROOT/docs/privacy.md"

if [ ! -f "$SOURCE" ]; then
  echo "deploy-privacy: $SOURCE not found" >&2
  exit 1
fi

echo "→ uploading $SOURCE to $JELLYFUSE_PRIVACY_HOST:$JELLYFUSE_PRIVACY_PATH/privacy.md"
rsync --checksum --compress --rsh=ssh "$SOURCE" "$JELLYFUSE_PRIVACY_HOST:$JELLYFUSE_PRIVACY_PATH/privacy.md"
echo "✓ deployed — verify at https://jellyfuse-privacy.tailba6a9d.ts.net/privacy.html"
