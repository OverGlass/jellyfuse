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
