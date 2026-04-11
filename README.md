# Jellyfuse

Native Jellyfin + Jellyseerr client. React Native (Expo) monorepo targeting iOS, iPadOS, Android, Apple TV, Android TV, and macOS (Mac Catalyst).

## Stack

- **Bun** workspaces · **Expo SDK 55** · **Expo Router** (typed routes) · **React Compiler** (strict)
- **TypeScript 7** via [`@typescript/native-preview`](https://github.com/microsoft/typescript-go) (`tsgo`) — drop-in `tsc` replacement, 10× faster
- **TanStack Query v5** (single async store) · **MMKV** persister · **Nitro Modules** + **Nitro Fetch**
- **FlashList v2** · **expo-image** · **native-mpv** Nitro module (player on all platforms)
- **oxfmt** (Rust-based formatter, Prettier-compatible) · **ESLint** · **Vitest** (pure TS) · **Jest + RTL** (RN)
- **1Password** for all secrets (local dev via `op inject` / `op run`, CI via `1password/load-secrets-action`)

## Getting started

```bash
# Install
bun install

# Verify
bun run typecheck
bun run test
bun run format:check

# App (0b onward)
bun run --filter @jellyfuse/mobile ios
bun run --filter @jellyfuse/mobile android
```

## Workspace layout

| Path                                     | Purpose                                                     |
| ---------------------------------------- | ----------------------------------------------------------- |
| `apps/mobile`                            | Expo app (iOS, iPadOS, tvOS, Catalyst, Android, Android TV) |
| `apps/web`                               | (future) marketing / landing page                           |
| `packages/api`                           | Pure TS Jellyfin + Jellyseerr HTTP clients                  |
| `packages/models`                        | Domain types (ported from `jf-core/models.rs`)              |
| `packages/query-keys`                    | TanStack Query key factory + stale times                    |
| `packages/theme`                         | Design tokens shared across apps                            |
| `modules/native-mpv`                     | MPV player — Swift + Kotlin Nitro module                    |
| `modules/downloader`                     | Background downloads — URLSession / WorkManager             |
| `modules/secure-storage`                 | Keychain / Keystore                                         |
| `modules/device-id`                      | Stable device ID                                            |
| `modules/cookie-jar`                     | Jellyseerr `connect.sid`                                    |
| `modules/chromecast` · `airplay` · `pip` | Cast / AirPlay / Picture-in-Picture                         |
| `tooling/*`                              | Shared `tsconfig`, eslint, vitest preset                    |

## Secrets (1Password)

**Never commit secrets. Never hardcode URLs, tokens, or credentials.** All secrets flow through 1Password references.

- Local dev: copy `.env.tpl` → `.env` via `op inject -i .env.tpl -o .env`, or run commands under `op run -- bun run ios`.
- CI: `1password/load-secrets-action@v2` with a service-account token as the only raw GitHub secret.
- See [`docs/secrets.md`](docs/secrets.md) for the vault layout and `op://` references.

## Git flow

Trunk-based. `main` is always green. Short-lived `feat/…` / `fix/…` / `chore/…` branches. Conventional Commits enforced by commitlint. Pre-commit via lefthook. Squash merge. PR title must include the Linear issue key.

## License

UNLICENSED / private.
