#!/usr/bin/env bash
# Push docs/privacy.md to the self-hosted privacy service exposed via
# Tailscale Funnel at https://jellyfuse-privacy.tailba6a9d.ts.net/privacy.html.
#
# Delegates to the user's `jellyfuse-privacy` zsh alias (defined in their
# shell rc) — that alias owns the actual sync mechanism. Runs zsh in
# interactive mode so the alias resolves.
set -euo pipefail

if ! command -v zsh >/dev/null 2>&1; then
  echo "deploy-privacy: zsh not on PATH (the deploy alias lives in zshrc)" >&2
  exit 1
fi

exec zsh -ic 'jellyfuse-privacy deploy'
