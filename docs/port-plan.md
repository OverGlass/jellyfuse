# JellyFusion → React Native Port

## Context

JellyFusion today is a 14-crate Rust workspace using GPUI, targeting desktop + iOS. The user is restarting from scratch on React Native to get a professional, maintainable cross-platform client (iOS iPhone/iPad, Apple TV, Android phone/tablet, Android TV, macOS). Linux is dropped for v1. The Rust codebase is not shared — but its domain models, API surface, cache semantics, and feature inventory are the authoritative spec for the port. Key constraints from the user: Expo + Expo Router + Expo UI, Nitro Modules (including Nitro Fetch), React Query as the store for **all** async/server state, React Compiler for rerender optimisation, pure components, feature folders, DRY, professional-grade stability. **Player = MPV on every platform via a custom Nitro module.**

---

## Confirmed Decisions (from user)

| #   | Decision                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Linux: dropped for v1.**                                                                                                                                                                                                                                                          |
| 2   | **macOS: Mac Catalyst from the iOS target.** Same binary, 95% feature parity, one codebase. Chromecast will be swapped out on Catalyst.                                                                                                                                             |
| 3   | **v1 scope includes** Chromecast, AirPlay, PiP. **Excludes** DRM and tvOS offline downloads.                                                                                                                                                                                        |
| 4   | **Data/state**: React Query is the single store for _all_ async/server state (mirrors Rust `QueryCache`). Zustand only introduced if a concrete UI-only need arises (nav scroll positions, player controls visibility, request flow step machine). No new state lib until required. |
| 5   | **Persistence**: MMKV for RQ persister + small KV. SQLite only inside the downloader Nitro module (Android Room/WorkManager requires it).                                                                                                                                           |
| 6   | **Player**: **MPV everywhere** via a custom `native-mpv` Nitro module — iOS, tvOS, Mac Catalyst, Android, Android TV. Same behaviour across platforms, full control over HLS/tracks/trickplay/intro-skipper. No `react-native-video`.                                               |
| 7   | **Monorepo** (**Bun workspaces**): the app, custom native modules, and a future landing page / marketing site all live in one repo.                                                                                                                                                 |
| 8   | **HTTP**: Nitro Fetch everywhere.                                                                                                                                                                                                                                                   |
| 9   | **React Compiler** enabled from day 0, strict mode. No hand-written `memo` / `useMemo` / `useCallback`.                                                                                                                                                                             |
| 10  | **Typed routes** via Expo Router.                                                                                                                                                                                                                                                   |
| 11  | **Package manager: Bun.** Used for install, scripts, workspaces, and unit-test runner where feasible.                                                                                                                                                                               |
| 12  | **Apple extensions**: `expo-apple-targets` (Evan Bacon) to declaratively add Widgets, Live Activities, tvOS Top Shelf, Watch app targets from the same repo.                                                                                                                        |
| 13  | **Project management**: **Linear**. Every milestone/phase → Linear project; every DoD bullet → issue; PRs reference issue keys.                                                                                                                                                     |
| 14  | **Git flow**: trunk-based + short-lived feature branches, Conventional Commits, PR-per-issue, CI gating. Details in §Git Flow.                                                                                                                                                      |
| 15  | **Unit tests**: Vitest for pure TS packages (`packages/api`, `packages/models`, `packages/query-keys`), **Bun test** for `apps/mobile` non-RN utilities where possible, **Jest + React Native Testing Library** for components and hooks that need the RN renderer.                 |
| 16  | **`CLAUDE.md` in the new repo**: capture architectural rules + Claude collaboration preferences so future Claude sessions stay coherent.                                                                                                                                            |

---

## Monorepo Layout (Bun workspaces)

```
jellyfusion/                               # Bun workspace root
├─ package.json                            # "workspaces": ["apps/*","packages/*","modules/*","tooling/*"]
├─ bun.lockb
├─ CLAUDE.md                               # architectural rules + Claude collaboration guide (see §CLAUDE.md)
├─ .github/workflows/                      # CI: typecheck, lint, test, prebuild, EAS build
├─ apps/
│  ├─ mobile/                              # Expo app (iOS, iPadOS, tvOS, Catalyst, Android, AndroidTV)
│  │  ├─ app/                              # Expo Router file tree (typed routes)
│  │  ├─ features/                         # feature folders
│  │  ├─ services/
│  │  ├─ theme/
│  │  ├─ targets/                          # expo-apple-targets declarations (widgets, live activity, top shelf)
│  │  ├─ ios/                              # prebuild output
│  │  ├─ android/                          # prebuild output
│  │  └─ app.config.ts                     # dynamic, gated by EXPO_TV; wires expo-apple-targets plugin
│  └─ web/                                 # (future) marketing site + landing page
├─ packages/
│  ├─ api/                                 # pure TS Jellyfin + Jellyseerr clients (usable from app AND web)
│  ├─ models/                              # TS types ported from jf-core/models.rs
│  ├─ query-keys/                          # QueryKey factory + stale times (mirrors jf-core/query.rs)
│  └─ theme/                               # shared design tokens (app + landing page)
├─ modules/                                # Nitro native modules
│  ├─ native-mpv/                          # MPV player, hybrid object with events
│  ├─ downloader/                          # URLSession background / WorkManager
│  ├─ secure-storage/                      # Keychain / Keystore
│  ├─ device-id/
│  ├─ cookie-jar/                          # Jellyseerr connect.sid
│  ├─ chromecast/                          # Google Cast SDK
│  ├─ airplay/                             # AVRoutePickerView
│  └─ pip/                                 # PiP controller
└─ tooling/                                # eslint, tsconfig-base, prettier, vitest-preset, ci helpers
```

Bun is used for `bun install`, workspace linking, running scripts (`bun run`), and as the test runner for Vitest-compatible suites in pure TS packages. Expo CLI and prebuild still invoke their own toolchain underneath; Bun replaces npm/pnpm at the entry point.

### `apps/mobile/app/` (Expo Router)

```
app/
├─ _layout.tsx                             # Providers: QueryClient, Theme, Connection, NavState
├─ (auth)/
│  ├─ _layout.tsx
│  ├─ server.tsx                           # Jellyfin URL entry
│  ├─ sign-in.tsx                          # AuthenticateByName
│  └─ profile-picker.tsx
├─ (app)/
│  ├─ _layout.tsx                          # tab/stack, auth redirect
│  ├─ (tabs)/
│  │  ├─ home.tsx
│  │  ├─ search.tsx
│  │  ├─ downloads.tsx
│  │  └─ settings.tsx
│  ├─ shelf/[shelfKey].tsx                 # "see all" grid
│  ├─ detail/
│  │  ├─ movie/[jellyfinId].tsx
│  │  ├─ series/[jellyfinId].tsx
│  │  └─ tmdb/[tmdbId].tsx                 # Jellyseerr-only items
│  ├─ player/[jellyfinId].tsx              # fullscreen modal
│  └─ requests/index.tsx
└─ +not-found.tsx
```

### `apps/mobile/features/`

```
features/
├─ home/          { screens, components, hooks }
├─ detail/
├─ player/
├─ search/
├─ downloads/
├─ requests/
├─ settings/
├─ profile/
└─ common/        { MediaCard, Shelf, Modal, BottomSheet, ConnectionBanner, Focusable, ... }
```

Mirrors the feedback memory "feature folders, not layer folders" and CLAUDE.md's `home/`, `detail/`, `player/`, `common/` convention.

---

## Feature Inventory (ported from Rust — what must ship)

Complete surface mined from the Rust codebase. Each bullet must have an owning feature folder, a query hook, and (if interactive) a pure component with callback props.

- **Auth**: `AuthenticateByName` (Jellyfin), Jellyseerr cookie login, multi-user list, profile picker with add-user modal that preserves state (commit `7a748581`).
- **Device ID**: stable, Keychain/Keystore-persisted. Never random-per-session.
- **Home shelves**: Continue Watching, Next Up, Recently Added, Latest Movies, Latest TV, Suggestions, Requests, Local Downloads.
- **Shelf "see all" grid**: virtualized, infinite scroll (`LoadMoreItems`).
- **Detail — movie**: hero, overview, play/resume, request flow.
- **Detail — series**: season tabs, merged Jellyfin + Jellyseerr seasons, episode lists.
- **Request flow** (`state.rs::RequestFlow`): multi-step modal — seasons → quality profile → confirm. Port as a Zustand step machine _if_ needed; otherwise a `useReducer`.
- **Search (blended)**: parallel Jellyfin + Jellyseerr, deduped by TMDB id.
- **Player**: MPV via Nitro. DirectPlay + DirectStream + Transcode selection from `PlaybackInfo`. Audio track / subtitle track / rate / volume / seek. Trickplay scrub thumbnails, intro/recap/credits skipper, chapter markers. PiP hand-off. AirPlay route. Chromecast cast-out.
- **Playback reporting**: start/progress/stopped including `MediaSourceId`, `PlayMethod`, `CanSeek`. Pending report queue (offline-safe), drained on reconnect.
- **Connection state**: NetInfo + server health ping; banner; Jellyseerr reconnect banner.
- **Settings**: server URLs, audio language, subtitle mode (Off / OnlyForced / Always), max streaming bitrate, sign-out, downloads mgmt.
- **Offline downloads**: queue/pause/resume/cancel/delete/retry/clear-all; range-resume; rebased paths on load (commit `ed09f547`); local-first play; capture duration + chapters + intro-skipper + trickplay at enqueue time so offline playback is full-fidelity (commit `f29ff269`).
- **Jellyseerr download progress** (Radarr/Sonarr queue): 10s RQ `refetchInterval`.
- **Quality profiles lookup**: 30-min stale.
- **Nav state preservation**: shelf scroll + detail scroll restored across back-nav (commits `2545b7de`, `c7e36f0d`).
- **Accessibility, safe area, orientation**: VoiceOver / TalkBack / tvOS VoiceOver.
- **TV remote focus**: D-pad, menu-button back, 10-foot UI.
- **Keyboard navigation on macOS Catalyst**: arrow + vim keys (from `Settings.vim_keys`).
- **Image cache**: `expo-image` (replaces `jf-ui-kit/image_cache.rs`).

---

## Data Layer — React Query as the single async store

**The rule from CLAUDE.md ported verbatim: components never fetch. All server/async data flows through React Query.**

- `packages/query-keys/` exports a key factory 1:1 mirroring the Rust `QueryKey` enum in `crates/jf-core/src/query.rs`. Same variants, same stale times (centralised in one file).
- `packages/api/` exports pure functions for every endpoint used today in `crates/jf-api/src/jellyfin.rs` and `jellyseerr.rs`. No classes, no state. Takes an `ApiClient` instance injected at the call site.
- `apps/mobile/services/query/hooks/` wraps each key in a `useXxx()` hook (`useContinueWatching`, `useMovieDetail`, `useSeriesDetail`, `useSeasonEpisodes`, `useSearchBlended`, `useRequests`, `useQualityProfiles`, `useDownloadProgressMap`, `useLocalDownloads`, ...).
- **Persistence**: `@tanstack/query-async-storage-persister` backed by `react-native-mmkv`. Persisted keys hydrate as immediately-stale → triggers background revalidation on boot, matching the Rust `hydrate()` behaviour.
- **`LocalDownloads` is NOT persisted through RQ**; the `downloader` Nitro module holds the on-disk source of truth (like sled does today) and pushes deltas up via a Nitro event → `queryClient.setQueryData`.
- **Pending playback reports** (mirrors `PendingReport` sled tree) live in a dedicated MMKV entry, drained by `services/connection/monitor.ts` on reconnect.
- **Optimistic updates** (mirrors Rust "update both view state and cache entry" rule): always `setQueryData` first, then fire the mutation, `onError` rollback. Explicit patterns for watched/unwatched, request creation, progress updates.
- **Invalidation `invalidate_matching` equivalent**: a small `invalidateWhere(predicate)` helper iterating cached query keys.
- **User switch**: `queryClient.clear()` — simpler and safer than selective invalidation; every query key already scoped by `userId`.
- **Zero duplicate server state elsewhere.** If it's on the server, it lives in RQ.

### UI-only state (introduced only if needed)

Only created when there is a concrete need the RQ model can't express:

- `navState` — scroll offsets keyed by route + list id (feature memory `2545b7de`).
- `playerUi` — controls visibility timer, volume HUD, gesture state.
- `requestFlow` — the `RequestStep` state machine.
- `connection` — merged NetInfo + health-ping signal for banner.

Start with `useReducer`/`useState`; promote to Zustand store only if two+ screens need to read the same non-server state.

---

## API Layer

- **`ApiClient`** built on Nitro Fetch. Injects `X-Emby-Authorization` (device id + token + client name + version) — port of `auth_headers()` at `crates/jf-api/src/jellyfin.rs:231`. Detects 401 → sets auth state to expired.
- **Jellyseerr cookie** (`connect.sid`): dedicated `modules/cookie-jar` Nitro module — RN's built-in cookie handling is inconsistent across platforms; critical for session reliability.
- **Port every endpoint currently used**. Comprehensive list:
  - Jellyfin: `/System/Info/Public`, `/Users/AuthenticateByName`, `/Users`, `/Users/{uid}/Items/Resume`, `/Users/{uid}/Items/Latest`, `/Users/{uid}/Items` (shelves/filters), `/Shows/NextUp`, `/Shows/{sid}/Seasons`, `/Shows/{sid}/Episodes`, `/Items/{id}/PlaybackInfo`, `/Videos/{id}/Trickplay`, intro-skipper plugin route, `/Sessions/Playing|Progress|Stopped`, `/Users/{uid}/Items/{id}/UserData`, image URL builders.
  - Jellyseerr: `/auth/local`, `/search`, `/discover/*`, `/{movie|tv}/{tmdbId}`, `/request` (GET + POST), `/service/radarr`, `/service/sonarr`, `/tv/{tmdbId}/season/{n}`, Radarr/Sonarr download-progress polling routes.
- **Models** in `packages/models/`: direct TS port of `crates/jf-core/src/models.rs` (`MediaItem`, `PlaybackInfo`, `DownloadRecord`, `PendingReport`, `Settings`, `Chapter`, `TrickplayInfo`, `IntroSkipperSegments`, `SubtitleTrack`, `JellyfinUser`, `AuthenticatedUser`). `MediaId` as a discriminated union `{ kind: 'jellyfin' | 'tmdb' | 'both', ... }`.

---

## Nitro Modules

Each module lives in `modules/<name>/` with a TS spec, Swift impl (iOS/tvOS/Catalyst), Kotlin impl (Android/AndroidTV).

### `native-mpv` — the centrepiece

MPV on every platform, built from source or via the official `libmpv`:

- **iOS / tvOS / Catalyst**: link `libmpv` built for each SDK (mpv upstream provides iOS build scripts; reuse those and vendor a pinned fork). Render output via `MPVRenderContext` into a Metal-backed `CAMetalLayer` hosted in a Fabric view.
- **Android / Android TV**: link the existing mpv-android `libmpv.so` build; render via OpenGL ES into a `SurfaceView` / `TextureView` hosted in a Fabric view.
- **Hybrid object API** (TS spec):
  - `load(streamUrl, options)`, `play`, `pause`, `seek(seconds)`, `setAudioTrack(i)`, `setSubtitleTrack(i)`, `setRate(r)`, `setVolume(v)`, `setProperty(name, value)`, `getProperty(name)`, `attachPictureInPicture`, `release`.
  - Events: `onProgress(timeSec, durationSec)`, `onStateChange(state)`, `onEnded`, `onError`, `onTracksDiscovered(audio[], subtitle[])`, `onBuffering`, `onCacheSpeed`.
- **Consumes `PlaybackInfo` from JS** — stream URL, subtitle delivery URLs, audio/sub indices, duration, chapters, trickplay — same model shape as Rust today.
- **Intro-skipper / chapter markers / trickplay**: pure JS overlays, driven by `onProgress` events from MPV.
- **MPV config defaults** picked to match current mpv desktop behaviour from `jf-module-player`.

### Other modules

| Module           | Methods / Events                                                                                                                             | Platform notes                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `downloader`     | `enqueue`, `pause`, `resume`, `cancel`, `delete`, `list`, `rebaseAllPaths`, `importSideloadedManifest`; events `onProgress`, `onStateChange` | iOS: `URLSessionDownloadTask` + `.background` + resume data, on-disk manifest first pattern. Android: `WorkManager` + OkHttp Range + Room. Skipped on tvOS. |
| `secure-storage` | `set/get/delete`                                                                                                                             | Keychain / Android Keystore                                                                                                                                 |
| `device-id`      | `get()`                                                                                                                                      | Generates on first call, persists into secure-storage                                                                                                       |
| `cookie-jar`     | `setCookie/getCookie/clear`                                                                                                                  | Jellyseerr session                                                                                                                                          |
| `chromecast`     | `startDiscovery`, `getDevices`, `connect`, `loadMedia`, `sendControl`                                                                        | Google Cast SDK. Not built on Mac Catalyst (swap out with `#if !targetEnvironment(macCatalyst)`).                                                           |
| `airplay`        | `showRoutePicker`, `getCurrentRoute`, events                                                                                                 | iOS/tvOS/Catalyst; Android no-op                                                                                                                            |
| `pip`            | `start`, `stop`, `isSupported`, events                                                                                                       | iOS AVKit, Android PictureInPictureParams                                                                                                                   |

`expo-keep-awake` replaces `sleep_inhibit.rs` — no custom module.

---

## Components & Routing

- **Pure components** with props struct + callback fields. One file per component under `features/*/components/`. No reaching into parent state (CLAUDE.md rule mirrored).
- **React Compiler** strict mode from day 0. No manual `memo`/`useMemo`/`useCallback`. Callbacks passed into native modules come from refs (RC cannot stabilise across JS↔native boundary).
- **FlashList v2** for every scrollable list (shelves, grid, episode list, downloads, search).
- **`expo-image`** everywhere. Explicit width/height, `contentFit="cover"`, `recyclingKey`.
- **Expo UI** SwiftUI-backed components on Apple platforms (settings rows, pickers, segmented controls) where applicable; graceful fallback on Android.
- **Must-port component catalogue**: `MediaCard`, `MediaShelf`, `ShelfGrid`, `ActionButton`, `BackButton`, `BottomSheet`, `Checkbox`, `ConnectionBanner`, `DownloadButton`, `Input`, `JellyseerrBanner`, `Modal`, `ProgressBar`, `Radio`, `StatusBadge`, `TabBar`, detail `Hero`, `EpisodeRow`, `RequestModal` (multi-step), player `ControlsOverlay`, `Focusable` (TV wrapper).
- **Routing**: Expo Router typed routes; `(auth)` vs `(app)` groups; root `_layout.tsx` redirects on auth state. Deep links `jellyfusion://detail/...`, `jellyfusion://play/...`. tvOS/Android TV menu button remapped to back.
- **Nav state preservation**: custom `useRestoredScroll(routeKey)` hook reads/writes a store keyed by route+listId; FlashList offset saved on blur, restored on focus.

---

## Platform Matrix

| Platform             | Tier    | Approach                                                                                                                                                           |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iOS iPhone/iPad      | P0      | Expo prebuild, Swift Nitro modules                                                                                                                                 |
| Android phone/tablet | P0      | Expo prebuild, Kotlin Nitro modules                                                                                                                                |
| Apple TV (tvOS)      | P1      | `react-native-tvos` fork + `@react-native-tvos/config-tv` Expo plugin. Same JS; separate scheme. Nitro modules must build for tvOS SDK. Downloads omitted.         |
| Android TV           | P1      | Same Android build, leanback intent, focus-aware components via `Focusable`. Full feature parity including downloads.                                              |
| macOS                | P1      | **Mac Catalyst** from the iOS target. Nitro modules gated with `#if targetEnvironment(macCatalyst)` where needed. Chromecast swapped out. Keyboard nav + vim keys. |
| Linux                | Dropped | —                                                                                                                                                                  |

---

## Apple Targets (`expo-apple-targets`)

Evan Bacon's `expo-apple-targets` lets us declaratively add Apple platform extensions from the same Expo app — compiled alongside the main target via a config plugin. In `apps/mobile/targets/` we ship:

| Target                        | Platform     | Purpose                                                                                                                                                      |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Now Playing Live Activity** | iOS 16+      | Ongoing playback on Lock Screen + Dynamic Island. Reads from the same shared group container as the app.                                                     |
| **Continue Watching Widget**  | iOS / iPadOS | Home screen widget surfacing the top N Continue Watching items. Data fetched via App Group shared container populated by the main app on background refresh. |
| **Top Shelf Extension**       | tvOS         | Top-shelf strip on the Apple TV home screen showing Continue Watching / Next Up. Standard tvOS UX.                                                           |
| **Watch App (stretch)**       | watchOS      | Remote control for the MPV player via a simple now-playing surface. Deferred to post-v1.                                                                     |

Cross-target data sharing uses an **App Group** (`group.com.jellyfusion.shared`) containing an MMKV instance and a small JSON manifest written by the main app whenever Continue Watching / Next Up refresh. Widgets and Top Shelf read the manifest synchronously — no network calls from extensions.

---

## Project Management — Linear

Existing Linear workspace has one team: **Arkbase** (`2622edff-ee78-4ba8-a8e3-4a114814e0ab`). Recommendation: create a dedicated **JellyFusion RN** project under Arkbase (or a new team), then:

- **1 project per milestone phase** (Phase 0 through Phase 9). Each phase's DoD bullets become issues.
- **Labels**: `area:player`, `area:downloads`, `area:tv`, `area:catalyst`, `area:nitro`, `type:bug`, `type:feat`, `type:chore`, `risk:high`.
- **Cycles**: weekly, to force a rhythm. Phase issues distributed across cycles.
- **Issue templates**: each issue has Acceptance Criteria (mirrors phase DoD format), Test Plan, and a link to the relevant Rust source file path from the Critical Files list.
- **Linking**: every PR title contains `ARK-123` (or whatever prefix the new team uses) so Linear auto-links. Every commit message trailer uses `Refs ARK-123`.
- **Docs**: architectural decisions (e.g. "MPV on all platforms", "Catalyst over AppKit", "Bun over pnpm") go into Linear Docs so context is discoverable; the repo `CLAUDE.md` cross-references them.

Use `mcp__plugin_linear_linear__*` tools to create the project + epics + initial issues once Phase 0 kicks off (not during plan mode).

---

## Git Flow

**Trunk-based** with short-lived feature branches — simpler and better for a small team than GitFlow.

- **`main`** is always green, always deployable. Protected branch; CI required; no direct pushes.
- **Feature branches**: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`. Live for at most a few days. One Linear issue = one branch = one PR.
- **Phase branches**: optional larger phase branches (e.g. `phase/3-player`) that feature branches merge into when a phase needs integration testing before hitting main. Merge to main when the phase DoD is green.
- **Commits**: **Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`, `build:`, `ci:`). Scope hints at the feature folder (`feat(player): ...`, `fix(downloads): ...`) — mirrors the style the user already uses in the Rust repo.
- **PRs**: title starts with Linear key, body has Summary / Test plan. Squash merge into main.
- **Pre-commit hooks** via `lefthook` (or husky + lint-staged): typecheck, eslint, prettier, affected tests.
- **CI on every PR**: `bun install`, `bun run typecheck`, `bun run lint`, `bun run test` (Vitest + Jest), `bun run prebuild:dry-run` for iOS + Android + TV + Catalyst.
- **Release tags**: `v0.x.y` once Phase 5 is complete. EAS build profiles: `development`, `preview`, `production`.
- **Versioning**: single version across the monorepo (no independent package versions). Changelogs generated from conventional commits.
- **No force-push to main. No skipping hooks.**

---

## Unit Testing Strategy

Three test surfaces, each with the right tool for the job:

1. **Pure TS packages** (`packages/api`, `packages/models`, `packages/query-keys`): **Vitest**, run via Bun. No RN runtime needed. MSW for mocking Jellyfin / Jellyseerr HTTP responses; fixture JSON captured from real endpoints under `packages/api/__fixtures__/`.
   - Every public function of `packages/api` must have a test using a fixture.
   - Query key factory has a table test ensuring every `QueryKey` Rust variant has a corresponding JS key and stale time.

2. **Hooks and non-UI logic in the app** (`services/query/hooks`, `services/playback/resolver`, `services/playback/reporter`): **Jest** (Expo's default) + `@testing-library/react-hooks`. Query hooks tested against a mocked `ApiClient` wrapped in a test `QueryClientProvider`.
   - `resolver.ts`: table tests for DirectPlay/DirectStream/Transcode selection and subtitle/audio track picking driven by `Settings`.
   - `reporter.ts`: tests for pending-queue drain semantics.

3. **Components** (`features/*/components/*`): **Jest + React Native Testing Library**. Pure components are trivially testable because they're props-in/callbacks-out.
   - Snapshot tests discouraged except for very stable presentational components; prefer interaction tests (`fireEvent`, `expect(callback).toHaveBeenCalled`).
   - Critical flows covered: sign-in, profile pick, home shelf render, detail hero, request modal step machine, downloads row interactions, player controls overlay.

4. **Native modules** (`modules/*`): unit tests run on the native side — XCTest for Swift, JUnit + Robolectric for Kotlin. Mostly focused on the downloader state machine and MPV property wiring.

**Coverage target**: not a hard number, but every merged PR must keep total coverage trend flat or up. CI fails if a file touched in the PR drops below the previous coverage for that file.

---

## `CLAUDE.md` in the new repo

A fresh `CLAUDE.md` at the repo root, written in the same crisp style as the current Rust one, codifying:

1. **Build & run**: `bun install`, `bun run ios`, `bun run android`, `bun run tv:ios`, `bun run tv:android`, `bun run catalyst`, `bun run test`, `bun run typecheck`.
2. **Monorepo map**: apps / packages / modules table (mirror the Rust "Crate Map").
3. **Data flow rule** (ported from existing CLAUDE.md): "All async/server data flows through React Query. Views never fetch directly. Never duplicate server state in Zustand or component state."
4. **Layered rules**: UI (`features/*` pure components) / Data (RQ + packages/query-keys) / Network (`packages/api` — no business logic) / Orchestration (hooks in `services/`).
5. **Event / callback convention**: components are props-in / callbacks-out; never reach into parent state.
6. **Feature folders**, not layer folders.
7. **React Compiler rules**: no manual `memo`/`useMemo`/`useCallback`; callbacks to native modules go through refs.
8. **Nitro module conventions**: one TS spec per module, Swift + Kotlin impls, events are named `onXxx`, disposed via `release()`.
9. **Performance rules**: FlashList for everything scrollable; `expo-image` with explicit sizes + `recyclingKey`; no inline object allocation in list render paths.
10. **Git / commit conventions**: Conventional Commits, Linear key in PR title.
11. **Claude collaboration preferences** (from the existing user-level memories; repeat in-repo so anyone else collaborating with Claude on this project sees them):
    - No dead code or scaffolding — wire end-to-end.
    - Always fix warnings in new/modified code before reporting done.
    - Don't run `bun run ios` for the user — they launch and report back.
    - Use `bun run xcodegen` (or equivalent) rather than raw tools.
    - Thorough planning covering UX flows, edge cases, and forward-looking decisions.
    - Pure components, feature folders, DRY, React-query data pattern.
12. **Testing expectations**: when touching `packages/api`, add/update a Vitest test; when touching a hook, add a Jest test; when touching a component, add an RTL interaction test.
13. **What NOT to do**: no `react-native-video`, no raw `fetch`, no direct API calls from views, no untyped routes, no hand-written memoization.

---

## Milestone Plan (each phase must be shippable end-to-end)

### Phase 0 — Scaffold monorepo (foundation)

- **Bun** workspace at repo root; `apps/mobile`, `packages/api|models|query-keys|theme`, `modules/*` placeholders, `tooling/*`.
- `apps/mobile`: Expo (latest SDK), Expo Router typed routes, React Compiler strict, Nitro Modules, Nitro Fetch, TanStack Query v5 + MMKV persister, FlashList v2, `expo-image`, `expo-keep-awake`, `@react-native-tvos/config-tv` plugin gated by `EXPO_TV`, `expo-apple-targets` plugin wired in `app.config.ts`.
- `CLAUDE.md` at repo root (see §CLAUDE.md section) — ported from the Rust CLAUDE.md, adapted for RN.
- Linear project **JellyFusion RN** created with Phase 0–9 sub-projects; Phase 0 issues created per DoD bullet.
- Git: `main` branch protection, conventional commits enforced via commitlint, `lefthook` pre-commit (typecheck + lint + affected tests).
- CI on every PR: typecheck, lint, Vitest + Jest, prebuild dry-run for iOS / Android / Apple TV / Android TV / Mac Catalyst.
- Vitest + Jest wired; one smoke test per package proving the test harness works.
- **DoD**: builds run on iPhone sim, iPad sim, Android emu, Apple TV sim, Android TV emu, Mac Catalyst. "Hello" screen renders via Expo Router. `bun run test` green. CI green on an empty PR.

### Phase 1 — Auth + device ID + server connect

- Build `modules/secure-storage`, `modules/device-id`, `modules/cookie-jar`.
- `packages/api` Jellyfin client (auth endpoints), `packages/models` (Settings, User types).
- `(auth)/server.tsx` → pings `/System/Info/Public`, stores URL + version.
- `(auth)/sign-in.tsx` → AuthenticateByName.
- `(auth)/profile-picker.tsx` → list users, pick, store.
- Optional Jellyseerr login (cookie jar).
- Root redirect on auth state.
- **DoD**: sign in, persist across restart, switch profile (with add-user modal preserving state), sign out.

### Phase 2 — Home + detail (read-only)

- Port every home `QueryKey` to React Query hooks in `packages/query-keys` + `services/query/hooks`.
- MMKV persister with hydrate-as-stale.
- `features/home/screens/HomeScreen.tsx` composed of pure `MediaShelf` components over FlashList.
- `features/detail/screens/{Movie,Series,Tmdb}DetailScreen.tsx`: hero, overview, season tabs, episode list.
- Connection banner + health-ping monitor.
- Nav state preservation on home + detail scroll.
- Shelf "see all" grid with infinite load.
- **DoD**: offline-first boot renders persisted shelves, revalidates on online; detail screens functional; back-nav restores scroll.

### Phase 3 — Player (MPV Nitro)

- Build `modules/native-mpv` — iOS first, then Android.
- `services/playback/resolver.ts`: wraps `PlaybackInfo`, picks stream URL + tracks per Settings.
- `services/playback/reporter.ts`: start/progress/stopped + MMKV pending queue + drain on reconnect.
- `app/(app)/player/[id].tsx`: fullscreen modal, gestures, `ControlsOverlay`, scrubber with chapter markers + trickplay tiles.
- Intro-skipper button (when segments present).
- `usePlayItem()` hook + `expo-keep-awake`.
- **DoD**: movie + episode playback works on iPhone and Android with DirectPlay and Transcode; resume works; subtitles + audio track switch; trickplay scrub; progress reports to server.

### Phase 4 — Search + Jellyseerr requests

- Blended search hook, deduped.
- `features/requests/`: list + request flow modal (port `RequestStep`).
- `QualityProfiles` query (30-min stale).
- `DownloadProgressMap` polling (10s refetchInterval).
- **DoD**: search across both sources; request a Jellyseerr-only item; appears in requests list with progress.

### Phase 5 — Offline downloads

- Build `modules/downloader` (iOS URLSession background + Android WorkManager).
- Capture duration / chapters / intro-skipper / trickplay at enqueue (parity with commit `f29ff269`).
- Rebase-on-load path logic (commit `ed09f547`).
- Local-first play in resolver.
- Downloads screen: pause/resume/cancel/retry/delete/clear-all.
- DownloadButton on detail view.
- **DoD**: background download completes on iOS + Android, plays offline, survives app restart.

### Phase 6 — Profiles, settings, nav polish

- Profile switcher polish (add-user modal preserves state).
- Settings screen (server URLs, audio lang, subtitle mode, bitrate cap, Jellyseerr status).
- User switch → `queryClient.clear()`.
- Final nav state preservation audit across all scrollers.

### Phase 7 — TV platforms

- Enable `EXPO_TV=1` builds for iOS and Android schemes.
- `Focusable` wrapper everywhere interactive is.
- D-pad-aware `MediaCard`, shelves, modals. 10-foot typography.
- Menu button → back.
- tvOS skips downloads UI; Android TV full.
- **DoD**: full parity on Android TV; tvOS has everything except offline downloads.

### Phase 8 — macOS Catalyst

- Flip iOS target to Catalyst destination; audit each Nitro module for Catalyst SDK.
- `#if !targetEnvironment(macCatalyst)` around Chromecast.
- Keyboard navigation with optional vim keys from Settings.
- Menu bar (File / Playback / View).
- Window resize behaviour.
- **DoD**: Catalyst build ships from same codebase.

### Phase 9 — Chromecast + AirPlay + PiP + polish

- `modules/chromecast`, `modules/airplay`, `modules/pip`.
- Lock-screen / notification playback controls (MPNowPlayingInfo / MediaSession).
- Accessibility pass.
- Image prefetch + preconnect.
- Performance sweep: FlashList item size estimators, `expo-image` priorities.

### Phase 10 — (Future) `apps/web` landing page + marketing

Not v1 scope — the monorepo layout reserves room for it.

---

## Critical Files to Read When Implementing (from the Rust codebase)

These are the authoritative spec for the port. Read before starting each phase:

- `/Users/antonincarlin/projects/fusion/CLAUDE.md` — architectural rules to mirror (data flow, pure components, feature folders, DRY orchestration, no dead code).
- `/Users/antonincarlin/projects/fusion/crates/jf-core/src/query.rs` — complete `QueryKey` enum + stale times + persistence scheme. **This IS the React Query key factory spec.**
- `/Users/antonincarlin/projects/fusion/crates/jf-core/src/models.rs` — every domain type (`MediaItem`, `PlaybackInfo`, `DownloadRecord`, `PendingReport`, `Settings`, `Chapter`, `TrickplayInfo`, `IntroSkipperSegments`, `SubtitleTrack`) to port 1:1 as TS interfaces.
- `/Users/antonincarlin/projects/fusion/crates/jf-core/src/state.rs` — `HomeState`, `DetailState`, `RequestFlow`, `ConnectionState`, `AuthState` — the shape of computed view state each screen expects.
- `/Users/antonincarlin/projects/fusion/crates/jf-api/src/jellyfin.rs` — full Jellyfin endpoint surface, `auth_headers()` (L231), playback reporting (L905/930/957), trickplay, intro-skipper.
- `/Users/antonincarlin/projects/fusion/crates/jf-api/src/jellyseerr.rs` — Jellyseerr endpoints, cookie session, requests, quality profiles, download progress.
- `/Users/antonincarlin/projects/fusion/crates/jf-ui-kit/src/orchestration.rs` — DRY shared hooks pattern; lists operations that become TS hooks.
- `/Users/antonincarlin/projects/fusion/crates/jf-module-download/src/{backend.rs,reqwest_backend.rs,storage.rs,handle.rs}` — blueprint for `downloader` Nitro module: state machine, range resume, manifest shape.
- `/Users/antonincarlin/projects/fusion/crates/jf-module-player/src/{backend.rs,mpv_video_gl.rs,mpv_video.rs}` — MPV config defaults, property names, how PlaybackInfo → MPV options today (direct blueprint for `native-mpv`).
- `/Users/antonincarlin/projects/fusion/crates/jf-desktop/src/{data.rs,routing.rs}` — shows which events map to which mutations/invalidations, what is optimistically updated, when cache is invalidated.
- `/Users/antonincarlin/projects/fusion/crates/jf-ui-kit/src/nav_state.rs` — nav state preservation scheme to mirror.
- `/Users/antonincarlin/projects/fusion/ios/JellyFusion/{JFSettingsScreen.swift,JFSearchBridge.m,JFTransitionBridge.m}` — current iOS native patterns to inform Nitro module implementations.

---

## Top Risks + Mitigations

| Risk                                                                                           | Severity | Mitigation                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Building libmpv for every Apple/Android target** (iOS, tvOS, Catalyst, Android arm64/x86_64) | **High** | Vendor a pinned libmpv build script per platform; CI builds artefacts and caches them. Phase 0 must prove the build works on at least iPhone sim before committing deeper. Fallback: start with iOS-only MPV in Phase 3, add tvOS/Catalyst/Android in later phases. |
| MPV renderer integration (Metal on Apple, OpenGL ES on Android) hosted in a Fabric view        | High     | Prototype the Fabric host view + `MPVRenderContext` in Phase 0; keep the TS spec stable while the render path evolves.                                                                                                                                              |
| TV focus engine complexity                                                                     | High     | Start `Focusable` wrapper in Phase 0 so every interactive piece uses it from day 1, not bolted on in Phase 7.                                                                                                                                                       |
| Nitro Modules learning curve                                                                   | Medium   | Start with `secure-storage` (simplest) in Phase 1 to ramp up; keep a cookbook in `modules/README.md`.                                                                                                                                                               |
| iOS background downloads (URLSession can deliver events after process death)                   | High     | Manifest-on-disk-first pattern: every state transition writes to disk before notifying JS. On relaunch, native hydrates from manifest before JS asks. Mirrors sled behaviour today.                                                                                 |
| Android 14 foreground service types for downloads                                              | High     | Use `dataSync` / `shortService` foreground service type; justify in manifest; test against API 34.                                                                                                                                                                  |
| React Compiler + library compatibility                                                         | Medium   | Audit in Phase 0. Known-good: RN core, RQ v5, Zustand, Reanimated 3, FlashList v2, expo-image. Enable the ESLint React Compiler rule.                                                                                                                               |
| Jellyseerr cookie session expiry                                                               | Medium   | Detect 401 → show `JellyseerrBanner` reconnect (port of existing component) → re-login.                                                                                                                                                                             |
| Multi-user data collision in RQ                                                                | Medium   | Every query key scoped by `userId`; on user switch, `queryClient.clear()`.                                                                                                                                                                                          |
| Mac Catalyst Nitro module SDK gaps                                                             | Medium   | Every Nitro module's podspec declares Catalyst SDK; Phase 0 CI builds for all targets to catch early. Chromecast gated out.                                                                                                                                         |
| Persistence schema drift                                                                       | Low      | MMKV entry carries a schema version; drop persisted cache on version bump.                                                                                                                                                                                          |

---

## Verification

Each phase has an explicit DoD above. The overall project is verified by:

1. **Builds** — EAS build (or local Expo prebuild + Xcode / Gradle) succeeds for every tier-P0 and P1 target in the matrix.
2. **Smoke tests per phase** — run the app on the phase's target platform, execute the DoD scenarios manually.
3. **Unit tests** — `bun run test` runs Vitest (pure TS) + Jest (RN). Coverage trend enforced in CI.
4. **Type safety** — `tsc --noEmit` across the workspace in CI; Expo Router typed routes enforce route correctness.
5. **React Compiler compliance** — ESLint React Compiler rule in CI; no manual memoization allowed.
6. **Lint + format** — ESLint + Prettier via Bun scripts.
7. **Offline first-boot test** — kill the network, launch the app, confirm home renders from MMKV-persisted cache.
8. **Background download test** (Phase 5) — queue a download, background the app, lock the device, confirm completion on wake.
9. **Player parity test** (Phase 3) — DirectPlay movie, Transcoded episode, HLS, sidecar subtitle, intro-skipper, trickplay scrub — all exercised via MPV on each platform.
10. **TV navigation test** (Phase 7) — full D-pad traversal of home → detail → player without a touchscreen.
11. **Widget / Live Activity check** — Continue Watching widget renders from shared App Group manifest; Live Activity appears when playback starts.
12. **Linear hygiene** — every merged PR closes at least one Linear issue; cycle review at end of each phase.
13. **Expo MCP** available to sanity-check current Expo SDK APIs during implementation.

---

## Open Items (resolve during Phase 0, not blocking plan approval)

1. Pin Expo SDK version that has tvOS fork parity (check `react-native-tvos` release notes).
2. Pick libmpv build source: upstream mpv iOS scripts vs `mpv-ios` community fork vs bespoke script — evaluate at Phase 0 start.
3. Confirm Nitro Fetch handles streaming body responses needed for trickplay sprite sheets (otherwise fall back to `expo-file-system` for that single case).
