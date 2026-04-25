# Jellyfuse local dev environment template.
#
# Never edit this file with real secret values. Instead:
#   op inject -i .env.tpl -o .env
# or:
#   op run --env-file=.env.tpl -- bun run --filter @jellyfuse/mobile ios
#
# See docs/secrets.md for the full vault layout.

JELLYFIN_DEV_URL=op://Jellyfuse Dev/dev-server/url
JELLYFIN_DEV_USER=op://Jellyfuse Dev/dev-server/username
JELLYFIN_DEV_PASSWORD=op://Jellyfuse Dev/dev-server/password

JELLYSEERR_DEV_URL=op://Jellyfuse Dev/jellyseerr/url
JELLYSEERR_DEV_EMAIL=op://Jellyfuse Dev/jellyseerr/email
JELLYSEERR_DEV_PASSWORD=op://Jellyfuse Dev/jellyseerr/password

SENTRY_DSN=op://Jellyfuse Dev/sentry/dsn

# App Store submission (used by `eas submit`).
# Run as: op run --env-file=.env.tpl -- eas submit --platform ios --profile production --latest
EXPO_APPLE_ID=op://Jellyfuse CI/AppleID/email
EXPO_APPLE_APP_SPECIFIC_PASSWORD=op://Jellyfuse CI/AppleID/app-specific-password
