# Secrets — 1Password

**Hard rule: no plaintext secrets in this repo. Ever.** All secrets — API tokens, server URLs used in CI, signing certificates, keystore passphrases, EAS tokens, Apple/Google credentials — live in 1Password and are pulled in on demand via `op inject`, `op run`, or the `1password/load-secrets-action` GitHub Action.

This is enforced by the CLAUDE.md ban on hardcoding secrets and by the `.gitignore` rules that block every `.env*` except `*.tpl` templates.

## Vaults

Two vaults owned by the Jellyfuse workspace:

| Vault | Purpose | Who |
|---|---|---|
| `Jellyfuse Dev` | Local development secrets (dev Jellyfin URL, test user credentials, Sentry DSN for dev). | Engineers |
| `Jellyfuse CI` | CI-only secrets: EAS token, Apple App Store Connect API key, Android keystore passphrase, Google Play service account JSON, Sentry release DSN, signing profiles. | CI service account (read-only) |

## Local development

1. Install the 1Password CLI:
   ```bash
   brew install --cask 1password-cli
   op signin
   ```
2. Copy the template:
   ```bash
   op inject -i .env.tpl -o .env
   ```
   or run commands under 1Password without materialising a file:
   ```bash
   op run --env-file=.env.tpl -- bun run --filter @jellyfuse/mobile ios
   ```
3. `.env` is `.gitignore`d. Never commit it.

## `.env.tpl` format

`.env.tpl` uses `op://` references:

```
JELLYFIN_DEV_URL=op://Jellyfuse Dev/dev-server/url
JELLYFIN_DEV_USER=op://Jellyfuse Dev/dev-server/username
JELLYFIN_DEV_PASSWORD=op://Jellyfuse Dev/dev-server/password
SENTRY_DSN=op://Jellyfuse Dev/sentry/dsn
```

## CI (GitHub Actions)

Only **one** raw GitHub Actions secret exists: `OP_SERVICE_ACCOUNT_TOKEN`, a 1Password service account token scoped to the `Jellyfuse CI` vault (read-only).

Every job that needs secrets loads them via:

```yaml
- uses: 1password/load-secrets-action@v2
  env:
    OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_SERVICE_ACCOUNT_TOKEN }}
  with:
    export-env: true
    secrets: |
      EXPO_TOKEN=op://Jellyfuse CI/eas/token
      APPLE_API_KEY=op://Jellyfuse CI/appstore-connect/api-key
      ANDROID_KEYSTORE_PASSWORD=op://Jellyfuse CI/android-keystore/password
```

## EAS

`eas.json` references env vars only. Secrets populated by the `load-secrets-action` step before `eas build` runs.

## Signing & provisioning

- **iOS**: provisioning profiles and `.p12` certs stored as 1Password **documents** in `Jellyfuse CI`. Pulled via `op document get "ios distribution profile" --output ./tmp/profile.mobileprovision` at build time.
- **Android**: upload keystore stored as a 1Password document; passphrase stored as a separate field.

## Rotation

When a credential is rotated, update the 1Password item — CI picks it up automatically on the next run. There is no separate "update GitHub secrets" step because there are no raw secrets in GitHub to update.

## Auditing

`op events api` can be used to audit which service account pulled which secret from CI. Review monthly.
