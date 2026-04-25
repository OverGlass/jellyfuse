
# Jellyfuse local dev environment template.
#
# Never edit this file with real secret values. Instead:
#   op inject -i .env.tpl -o .env
# or:
#   op run --env-file=.env.tpl -- bun run --filter @jellyfuse/mobile ios
#
# See docs/secrets.md for the full vault layout.

# EAS project (read by apps/mobile/app.config.ts). Env-driven so a fork
# can ship to its own EAS project without editing committed files.
EAS_OWNER=op://fusion/eas/owner
EAS_PROJECT_ID=op://fusion/eas/project_id

# App Store submission (used by `eas submit`).
# Apple Team ID and ASC App ID live in eas.json (public values, not secrets).
# Only the Apple ID + app-specific password need to be kept out of git.
#
# Run as: op run --env-file=.env.tpl -- eas submit --platform ios --profile production --latest
EXPO_APPLE_ID=op://fusion/eas/username
EXPO_APPLE_APP_SPECIFIC_PASSWORD=op://fusion/eas/password
