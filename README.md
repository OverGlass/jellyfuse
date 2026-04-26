# Jellyfuse

A fast, native iPhone client for [Jellyfin](https://jellyfin.org), built around [MPV](https://mpv.io/). Bring your own server, stream your library, no telemetry.

> **Unofficial, third-party client.** Not affiliated with the Jellyfin or Jellyseerr projects. You need a Jellyfin server you control.

## Status

iOS 1.0 in App Store review — iPhone + iPad. Apple TV, Android, Android TV, and Mac Catalyst targets are scaffolded in the codebase but not yet shipping.

[**App Store**](#) _(link added on release)_ · [**Privacy Policy**](https://overglass.github.io/jellyfuse/privacy.html) · [**Issues**](https://github.com/OverGlass/jellyfuse/issues)

## What's in v1

- Native MPV-powered playback — Direct Play, Direct Stream, transcode all on the same engine.
- Background audio + Picture in Picture.
- Offline downloads with resume.
- Subtitle and audio track switching, including external `.srt` / `.ass`.
- Trickplay scrubbing, chapter markers, intro/outro skip when your library has them.
- Fast library browsing with shelves for resume, recently added, collections.
- Instant search across the whole library.
- Optional [Jellyseerr](https://docs.overseerr.dev/extensions/fork-jellyseerr) integration for media requests — if you don't connect one, the requests UI stays hidden.
- **Privacy first** — Jellyfuse only talks to your server. No analytics, no telemetry, no tracking. See [the Privacy Policy](https://overglass.github.io/jellyfuse/privacy.html).

## Try it without a server

The app's sign-in screen accepts the public Jellyfin demo: `https://demo.jellyfin.org/stable` (any username, leave the password blank).

## Building from source

Bun-workspace monorepo, Expo SDK 55, TypeScript 7 (via `@typescript/native-preview` — never install plain `typescript`).

```bash
bun install

# Sanity
bun run typecheck
bun run test
bun run format:check

# Run on iOS simulator (the only platform validated for v1)
bun run --filter @jellyfuse/mobile ios
```

To produce a signed `.ipa` for the App Store you need an Apple Developer account and EAS credentials of your own; the [submission runbook](docs/store-submission.md) walks through it. The Apple Team ID (`39TMVBW2CY`) and ASC App ID (`6761692584`) committed to this repo are the maintainer's — replace them with your own (in `apps/mobile/eas.json`) if you want to ship to your own App Store record. The EAS owner and project ID are env-driven; set `EAS_OWNER` and `EAS_PROJECT_ID` in your `.env` (see `.env.tpl`).

### Stack

- **Bun** workspaces · **Expo SDK 55** · **Expo Router** (typed routes) · **React Compiler** (strict)
- **TanStack Query v5** as the only async store · **MMKV** persister
- **Nitro Modules** + **Nitro Fetch**
- **FlashList v2** · **expo-image**
- **`native-mpv`** Nitro module — Swift on iOS, Kotlin on Android, the only video backend
- **oxfmt** (Rust formatter — never Prettier) · **ESLint** · **Vitest** (pure TS) · **Jest + RTL** (RN)

### Workspace layout

| Path                                     | Purpose                                             |
| ---------------------------------------- | --------------------------------------------------- |
| `apps/mobile`                            | Expo app — all platform targets share this codebase |
| `packages/api`                           | Pure TS Jellyfin + Jellyseerr HTTP clients          |
| `packages/models`                        | Domain types                                        |
| `packages/query-keys`                    | TanStack Query key factory + stale times            |
| `packages/theme`                         | Design tokens                                       |
| `modules/native-mpv`                     | MPV player Nitro module                             |
| `modules/downloader`                     | Background downloads (URLSession / WorkManager)     |
| `modules/secure-storage`                 | Keychain / Keystore                                 |
| `modules/device-id`                      | Stable device ID                                    |
| `modules/cookie-jar`                     | Jellyseerr `connect.sid` cookie                     |
| `modules/chromecast` · `airplay` · `pip` | Cast / AirPlay / Picture-in-Picture                 |
| `tooling/*`                              | Shared `tsconfig`, ESLint, Vitest preset            |

[`CLAUDE.md`](CLAUDE.md) is the source of truth for architectural rules (data flow, pure components, feature folders, Nitro module conventions).

### A note on the `../fusion` reference

CLAUDE.md and a few comments mention a sibling `../fusion` Rust repo as the architectural spec. That repo is currently private — it was the original Jellyfin/Jellyseerr client written in Rust, and Jellyfuse is the React Native port. You don't need it to build, run, or contribute; the references exist so the maintainer can keep behaviour aligned during the port. If/when `fusion` opens up, this note will be replaced with a link.

## Contributing

Issues and PRs welcome. Before opening a PR:

- Read [`CLAUDE.md`](CLAUDE.md) — architectural rules apply to humans too.
- Run `bun run typecheck && bun run test && bun run format:check`.
- Conventional Commits with the feature folder as scope: `feat(player): …`, `fix(downloads): …`.
- Squash merge to `main`. No force-push to `main`. Hooks are never skipped.

## Secrets

Never commit secrets. The repo uses [1Password](https://1password.com) for everything sensitive — see [`docs/secrets.md`](docs/secrets.md) for the vault layout and `op://` references. If you fork to ship your own build, replace the `op://` paths in `.env.tpl` with references into your own vault.

## License

[GNU General Public License v3.0](LICENSE) — see [`LICENSE`](LICENSE) for the full text.

```
Jellyfuse — native Jellyfin client for iOS
Copyright (C) 2026 Antonin Carlin

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, version 3.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.
```

Note: Jellyfuse is GPL-3.0; Jellyfin itself is GPL-2.0. Both are GPL-family but the licenses are not directly compatible — Jellyfuse only talks to Jellyfin over its public HTTP API, so this is a normal cross-license consumer/server relationship, not derivative work.
