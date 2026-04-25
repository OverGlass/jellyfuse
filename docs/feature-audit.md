# Jellyfuse — Feature Audit & Release Roadmap

## Context

Jellyfuse is a React Native (Expo) Jellyfin + Jellyseerr client porting the Rust JellyFusion app. Today the codebase is a polished iOS/iPadOS app at the end of `port-plan.md` Phases 0–6 with active work on Phase 3b (video pipeline) and an Android worktree. This document audits the current state against jellyfin-web (the canonical reference client), identifies gaps in the agreed scope, and proposes a prioritized release plan.

**Scope decisions:**

- Target a focused **movies + TV + Jellyseerr requests** client. **No music, no photos, no Live TV/DVR, no books** — these are out of scope, matching the original Rust spec.
- Platform path: **finish iOS/iPadOS feature parity first**. Land the video pipeline on `main`, close jellyfin-web feature gaps in iOS, then expand platforms. Android worktree continues in parallel but doesn't block iOS.

---

## 1. Current Implementation Audit

### Implemented end-to-end

| Area                                                                                                        | Status                                                                                        | Notes                                                  |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Auth (sign-in, multi-user, profile picker, Jellyseerr cookie)                                               | ✅                                                                                            | `apps/mobile/src/services/auth/state.tsx`              |
| Home shelves (Continue Watching, Next Up, Recently Added, Latest Movies, Latest TV, Active Requests)        | ✅                                                                                            | `features/home/screens/home-screen.tsx`                |
| Shelf "see all" infinite grid                                                                               | ✅                                                                                            | typed route `shelf/[shelfKey].tsx`                     |
| Movie / Series / TMDB-only detail screens                                                                   | ✅                                                                                            | hero, meta row, action row, season tabs, episode rows  |
| Series Resume button targets correct episode                                                                | ✅                                                                                            | recent fix `ba3640d`                                   |
| Search (blended Jellyfin + Jellyseerr, deduped on tmdbId)                                                   | ✅                                                                                            |                                                        |
| Requests (create, quality profile, season picker, Radarr/Sonarr progress)                                   | ✅                                                                                            | `features/requests/screens/request-flow-screen.tsx`    |
| Settings (server URL, audio/sub language, sub mode, autoplay, bitrate cap, Jellyseerr reconnect, sign-out)  | ✅                                                                                            | server-persisted via user config + local MMKV bitrate  |
| Connection monitor + offline-aware UX                                                                       | ✅                                                                                            | `services/connection/monitor.ts`, online manager       |
| Player audio/video on iOS via `native-mpv` Nitro                                                            | ✅ on `main` for audio + base video; advanced features on `feat/player-native-video-pipeline` |
| Player: trickplay, intro/credits skipper, chapters on scrubber, native track picker, preferred sub language | ✅                                                                                            | scrubber driven by SharedValues for zero RN re-renders |
| Player: lock-screen Now Playing + remote control + iOS auto-PiP                                             | ✅                                                                                            | `9ec9497`, `042e226`                                   |
| Player: watch credits + Up Next overlay + autoplay next (online + offline)                                  | ✅                                                                                            | `46292ee`, `65a7f44`                                   |
| Playback reporting (start/progress/stopped + offline pending queue + drainer)                               | ✅                                                                                            |                                                        |
| Offline downloads (queue, pause/resume/cancel/delete, range resume, sidecar metadata, local-first play)     | ✅                                                                                            | iOS background URLSession via `@jellyfuse/downloader`  |
| Per-episode download button with progress arc                                                               | ✅                                                                                            |                                                        |
| Nav state preservation (FlashList scroll across back-nav, every main screen)                                | ✅                                                                                            | `useRestoredScroll` hook                               |
| Image cache via expo-image                                                                                  | ✅                                                                                            | priority tiers wired                                   |
| Vitest (`packages/api`, `models`, `query-keys`) + Jest (RTL) coverage                                       | ✅                                                                                            |                                                        |

### Partially implemented or branch-only

| Area                                                                                                  | State                                                    | Where                                            |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------ |
| Player video pipeline (HDR / Dolby Vision / videotoolbox-copy / format-change rebuilds / bitmap subs) | 40+ commits ahead on `feat/player-native-video-pipeline` | not on `main`                                    |
| Android target                                                                                        | scaffolded only, work in `worktree-feat-android-phone`   | Kotlin `native-mpv` and `downloader` not started |
| i18n                                                                                                  | `feat/i18n` branch                                       | not on `main`                                    |

### Not started (per `port-plan.md`)

- Phase 7 — tvOS / Android TV (Focusable wrapper, D-pad nav, 10-foot UI, menu→back, Top Shelf extension)
- Phase 8 — Mac Catalyst
- Phase 9 — Chromecast / AirPlay / lock-screen polish (PiP done; AirPlay route picker + Cast SDK not done)
- Phase 10 — `apps/web` landing page

---

## 2. Gaps vs jellyfin-web (within the agreed scope)

### P0 — User-data primitives (table-stakes for any Jellyfin client)

1. **Watched / unwatched toggle** — `UserItemData.played` exists in models, no UI. Per-item AND per-season AND per-series. Endpoints: `POST /Users/{uid}/PlayedItems/{id}` and `DELETE`. Without this, Continue Watching can be polluted forever.
2. **Favorites toggle** — heart icon on detail + episode rows. `POST /Users/{uid}/FavoriteItems/{id}`. Persists to UserData.
3. **Mark season / series played-up-to-here** — long-press affordance on episode rows.
4. **User-supplied rating** (likes/dislikes 0/5/10). Less critical but commonly used.

These are 1-day features with outsized perceived completeness. No new screens needed; mutate existing query data optimistically.

### P0 — Library browse

5. **Library tabs / "All Movies" + "All Shows" grids** with sort + filter. jellyfin-web's `/list/movies` is the spine of the app. Today Jellyfuse has only the home shelves + see-all variants. Users have no way to browse the full library by alphabet, date added, year, genre, unplayed-only, or rating.
   - Expected sorts: SortName, DateCreated, DatePlayed, ProductionYear, CommunityRating, Random.
   - Expected filters: IsUnplayed, IsFavorite, Genres (multi), Years, OfficialRatings (PG/MA/etc), Studios, ParentalRating.
   - Existing `/Users/{uid}/Items` in `packages/api/src/shelves.ts` already supports the params; needs a `library` feature folder and screen.

6. **Genre / studio / tag drill-in** — tap a genre chip on detail → grid of items in that genre. Standard jellyfin-web flow.

7. **Collections (BoxSets)** — first-class concept in Jellyfin. jellyfin-web shows a Collections row + Collection detail. Models include `"collection"` MediaType but no UI. Movie detail should link to its parent collection.

### P1 — Detail-screen depth

8. **Cast & Crew rows** with photos, role, and tap-through to a Person detail screen showing filmography.
9. **Similar items** (`/Items/{id}/Similar`) — "More like this" rail at the bottom of detail.
10. **External IDs / links** — IMDb, TMDB, Trakt, TVDB buttons (tap → open URL).
11. **Special features / extras** (trailers, behind-the-scenes) — `/Users/{uid}/Items/{id}/SpecialFeatures`.
12. **Multiple versions / editions** picker — when a movie has multiple `MediaSources` (Director's Cut, Extended), Jellyfin exposes them. Today Jellyfuse silently picks the first.
13. **Series / season "Play next unwatched"** dedicated button.

### P1 — Player gaps

14. **Subtitle styling** (size, position, color, background, font) — MPV supports natively; needs a settings panel.
15. **Audio boost / normalisation** — MPV `audio-pitch-correction`, replaygain.
16. **Aspect ratio / zoom controls** — fit / fill / 16:9 / 4:3 toggle. MPV `video-aspect-override`.
17. **Speed control beyond 2x** — 0.5/0.75/1/1.25/1.5/1.75/2 menu.
18. **Bitrate overlay / debug HUD** — long-press in player shows codec / bitrate / dropped frames.
19. **Subtitle delay / audio delay sliders** — sync correction. MPV native.

### P1 — Multi-server / Quick Connect

20. **Quick Connect** — Jellyfin's pairing-code login flow (`/QuickConnect/Initiate`). Important for TV/Catalyst phases.
21. **Multi-server switching** — store more than one `(serverUrl, user)` and let the user switch. Auth state today is single-server.

### P2 — Polish & long-tail

22. **Continue Watching dismiss** — long-press → "Hide from Continue Watching".
23. **Play queue management** — adding multiple items, "Play next", "Add to queue".
24. **Playlist support** (user-created) — `/Playlists` API.
25. **Server notifications** — `/Notifications/{uid}`.
26. **Theme song / theme video on detail** — Jellyfin serves `/Items/{id}/ThemeSongs` and `/ThemeVideos`. Optional ambient touch.
27. **Subtitle search & download** — OpenSubtitles plugin integration. Skip.

### Out of scope

- Music, photos, books, audiobooks
- Live TV / EPG / DVR scheduling
- SyncPlay (group watching)
- Server admin (user/library management)

---

## 3. Code-quality findings

- **Adherence to CLAUDE.md is strong.** No raw `fetch`, no `react-native-video`, no untyped routes, no manual `useMemo`/`React.memo` outside the documented Nitro/SharedValue exceptions.
- **Player video work lives on a branch.** `feat/player-native-video-pipeline` is 40+ commits ahead of `main`. This is the single biggest piece of unfinished core work and should land before adding new features.
- **`modules/` only contains `native-mpv` and `downloader`.** The original plan named separate Nitro modules for `secure-storage`, `device-id`, `cookie-jar`, `chromecast`, `airplay`, `pip`. In practice secure-storage / device-id / cookies are handled by Expo modules + iOS-side code in `native-mpv` (PiP/Now Playing) — fine. AirPlay/Chromecast simply aren't built yet.
- **No `Suggestions` shelf** despite being in the plan's Feature Inventory. Low priority; overlaps with Continue Watching + Next Up.
- **No i18n on `main`.** Strings are hardcoded English. `feat/i18n` branch exists.

---

## 4. Prioritized Release Roadmap (iOS-first)

### v1.0 — "Real Jellyfin client" (next 2–3 weeks)

The minimum bar for a client to feel complete next to jellyfin-web. iOS-only.

**M1.0a — Player video on `main`** _(critical, blocking everything else)_

- Merge `feat/player-native-video-pipeline` after a final pass.
- Verify videotoolbox-copy decode, HDR / DV passthrough, format-change rebuild, bitmap subtitles end-to-end on physical iPhone + iPad.
- Test plan: SDR H.264 movie, 4K HDR10 movie, DV episode, MKV with PGS subs, mid-stream resolution change.
- Critical files: `modules/native-mpv/ios/*`, `apps/mobile/src/features/player/screens/player-screen.tsx`.

**M1.0b — User-data primitives** _(P0 #1–4)_

- Add `useToggleWatched`, `useToggleFavorite`, `useSetUserRating` mutation hooks in `apps/mobile/src/services/query/hooks/`.
- Optimistic `setQueryData` on detail + shelf caches. Rollback on error.
- Heart + checkmark on `detail-action-row.tsx`, `episode-row.tsx`, and `media-card.tsx` (long-press menu).
- New endpoint wrappers in `packages/api/src/userdata.ts` with Vitest fixtures.
- Invalidation: only the affected item's detail + shelves that filter on watched/favorite (Continue Watching, Next Up).

**M1.0c — Detail depth** _(P1 #8–13)_

- Cast & Crew row on movie + series detail (horizontal `FlashList`, `MediaCard` reused).
- New `app/(app)/person/[personId].tsx` showing filmography (uses `/Users/{uid}/Items` with `PersonIds` param).
- Similar rail at the bottom of detail (`/Items/{id}/Similar` query key, 30-min stale).
- External IDs row (linkable buttons).
- Multiple-versions picker when `MediaSources.length > 1`.
- "Play next unwatched" button on series detail.

**Verification:** TestFlight build. Toggle watched on a movie → vanishes from Continue Watching; favorite an episode → heart shows everywhere; open a person → see their filmography; play a movie with two versions → version picker appears.

### v1.1 — "Library browse + collections" (1–2 weeks after v1.0)

**M1.1a — Library browse** _(P0 #5–6)_

- New `features/library/` folder.
- Routes: `app/(app)/library/movies.tsx`, `app/(app)/library/shows.tsx`. Add a Library tab next to Home/Search/Downloads/Settings (re-evaluate tab bar — possible to demote Settings to a profile drawer).
- Sort + filter sheet (BottomSheet from `features/common`). Filter chips for Unplayed, Favorites, Genre (multi), Year range.
- Reuses existing `getItems` in `packages/api`. Adds query key `library/{libraryId}/{filters}` with infinite paging.
- Genre chip on detail page → opens `library/movies?genres=Action`.

**M1.1b — Collections** _(P0 #7)_

- Collections shelf on Home (`/Users/{uid}/Items?IncludeItemTypes=BoxSet`).
- Collection detail screen (`app/(app)/detail/collection/[id].tsx`) — list of member items.
- Movie detail shows "Part of {Collection Name}" → tap opens collection detail.

**Verification:** Browse Movies → sort by Year desc → filter Unplayed → tap Action genre on a movie → land on filtered list. Open a collection → see member films.

### v1.2 — "Player polish + Quick Connect" (1 week)

**M1.2a — Player power features** _(P1 #14–19)_

- Subtitle styling sheet (size / color / outline / position) → MPV `sub-` properties.
- Audio + subtitle delay sliders.
- Aspect-ratio toggle in player menu.
- Speed menu 0.5–2x with quarter steps.
- Long-press → debug HUD (codec, bitrate, dropped frames, sync, MPV vo).

**M1.2b — Quick Connect + multi-server** _(P1 #20–21)_

- New `(auth)/quick-connect.tsx` showing the 6-digit code.
- Multi-server: extend persisted shape to `{ servers: [{ url, users: [...] }] }`. Profile picker becomes server picker → user picker.

**Verification:** Run a server-paired Quick Connect from another device, get logged in. Add a second server and switch between them.

### v1.3 — Polish, dismiss, theme video (1 week)

- Long-press on Continue Watching card → "Mark watched" / "Hide". (P2 #22)
- Theme video / theme song on detail hero (autoplay muted, 10s preview). (P2 #26)
- "Play next" / "Queue" actions (P2 #23) only if user-tested as needed.
- i18n merge (Spanish/French/German baseline) — bring `feat/i18n` to main.

### v1.4 — Apple platform expansion

**M1.4a — Mac Catalyst (Phase 8)**

- Flip iOS target's `SUPPORTS_MACCATALYST = YES`, validate every Nitro pod's Catalyst SDK.
- Gate Chromecast (`#if !targetEnvironment(macCatalyst)`) — irrelevant since Cast isn't built yet.
- Keyboard nav: arrow keys + space/enter on Focusable; vim keys behind Settings.
- Window-size aware breakpoints (large grid layout).
- Menu bar (File / Playback / View) — minimal scaffold.

**M1.4b — tvOS (Phase 7)**

- `EXPO_TV=1` build. `Focusable` wrapper introduced and retrofitted across `MediaCard`, `MediaShelf`, episode rows, controls overlay, request modal.
- D-pad-aware scroll restoration.
- 10-foot typography (theme tokens already exist; needs scale-up override).
- Top Shelf extension via `expo-apple-targets` (Continue Watching + Next Up shared via App Group MMKV).
- Skip downloads UI on tvOS.
- Menu button → back.

**Verification:** Mac Catalyst window resize behaves; tvOS full nav from home → detail → player without touching the screen.

### v1.5 — Android (Phase 7 continuation)

Bring `worktree-feat-android-phone` to main when ready.

- Kotlin `native-mpv` (libmpv-android, vo=libmpv per memory `project_android_libmpv_ffmpeg_jvm`, TextureView per `feedback_android_video_surface`).
- Kotlin `downloader` (WorkManager + Room + OkHttp range).
- Android-specific: foreground service type for downloads (Android 14), MediaSession lock-screen.
- Android TV branch shares the Focusable infra from M1.4b.

### v1.6 — Casting (Phase 9)

- `modules/airplay` (iOS/Catalyst) — AVRoutePickerView + route-change events.
- `modules/chromecast` — Cast SDK on iOS + Android. Mini-controller + cast button.
- Catalyst gates Chromecast out.

### Deferred / not committed

- `apps/web` landing page (Phase 10).
- SubtitleEdit / OpenSubtitles search.
- Watch app companion.
- SyncPlay.

---

## 5. Critical files referenced

- `apps/mobile/src/services/auth/state.tsx` — extend for multi-server in v1.2.
- `apps/mobile/src/services/query/hooks/` — host all new mutation hooks.
- `apps/mobile/src/features/detail/components/{detail-action-row,episode-row}.tsx` — favorite/watched UI.
- `apps/mobile/src/features/home/components/{media-card,media-shelf,wide-media-card}.tsx` — long-press menu, watched checkmark.
- `apps/mobile/src/features/library/` _(new)_ — browse screens.
- `apps/mobile/src/features/person/` _(new)_ — person detail.
- `apps/mobile/src/features/collection/` _(new)_.
- `apps/mobile/app/(app)/(tabs)/_layout.tsx` — add Library tab.
- `apps/mobile/app/(app)/detail/{movie,series,collection,tmdb}/[id].tsx` — typed routes.
- `apps/mobile/app/(app)/person/[personId].tsx` _(new)_.
- `packages/api/src/{userdata,similar,collections,library}.ts` _(new files, one per concern)_.
- `packages/query-keys/src/index.ts` — extend with userdata/similar/collection/library/person keys + stale times.
- `packages/models/src/index.ts` — add `Person`, `BoxSet` if missing.
- `modules/native-mpv/ios/` — subtitle styling, delay, aspect properties (already supports via `setProperty`; only TS spec needs surfacing).

Reuse existing infra:

- `useRestoredScroll` for any new FlashList screen.
- `MediaCard` + `MediaShelf` for cast/similar/collection rows.
- `BottomSheet` from `features/common` for sort/filter sheet.
- `ProgressButton` (`c9b73a4`) for any new action button surface.
- `services/query/optimistic` patterns from existing detail mutations.

---

## 6. Verification

1. **TestFlight build at every milestone boundary** (`bun run --filter @jellyfuse/mobile ios` for local sim; user does the actual build).
2. **Manual checklist** included with each milestone above. Run on iPhone + iPad + (after v1.4) Catalyst + tvOS.
3. **Vitest** in `packages/api` covers each new endpoint with an MSW fixture.
4. **Jest + RTL** for new hooks and components — interaction tests, not snapshots.
5. **Type check**: `bun run typecheck` (tsgo). Must be clean.
6. **Lint + format**: `bun run format:check`. Must be clean.
7. **CI prebuild dry-run** for every target tier still in scope.
8. For player work, **physical-device test matrix**: SDR H.264, 4K HDR10, DV, PGS subs, mid-stream resolution change, AirPlay handoff, lock-screen controls, PiP backgrounding.
9. **Argent simulator flow** for the user-data primitives milestone — record once, replay after each related change to catch regressions.

---

## 7. Recommended next step

Start with **M1.0a — land player video on `main`**. It unblocks confident TestFlight cuts of every subsequent feature and de-risks the single largest piece of branched work in the repo. v1.0b (user-data primitives) is a strong follow-up — high perceived-quality lift for low effort.
