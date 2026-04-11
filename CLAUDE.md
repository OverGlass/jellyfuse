# Jellyfuse

Native Jellyfin + Jellyseerr client built with React Native (Expo). Bun-workspace monorepo targeting iOS, iPadOS, tvOS, Android, Android TV, and macOS (Mac Catalyst). This file is the source of truth for architectural rules and Claude collaboration preferences — read it before making changes.

## Build & Run

```
bun install
bun run typecheck
bun run test
bun run format:check
bun run --filter @jellyfuse/mobile ios
bun run --filter @jellyfuse/mobile android
bun run --filter @jellyfuse/mobile tv:ios         # EXPO_TV=1
bun run --filter @jellyfuse/mobile tv:android     # EXPO_TV=1
bun run --filter @jellyfuse/mobile catalyst
```

## Workspace Map

| Path                                     | Role                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/mobile`                            | Expo app — all platform targets from one codebase                            |
| `apps/web`                               | (future) marketing / landing page                                            |
| `packages/api`                           | Pure TS Jellyfin + Jellyseerr HTTP clients. **No business logic, no state.** |
| `packages/models`                        | Domain types (ports `jf-core/src/models.rs`)                                 |
| `packages/query-keys`                    | TanStack Query key factory + stale times (ports `jf-core/src/query.rs`)      |
| `packages/theme`                         | Design tokens shared between app and web                                     |
| `modules/native-mpv`                     | MPV player Nitro module (Swift + Kotlin) — **the only video backend**        |
| `modules/downloader`                     | Background downloads (URLSession / WorkManager)                              |
| `modules/secure-storage`                 | Keychain / Keystore                                                          |
| `modules/device-id`                      | Stable device ID                                                             |
| `modules/cookie-jar`                     | Jellyseerr session cookie                                                    |
| `modules/chromecast` · `airplay` · `pip` | Cast / AirPlay / PiP                                                         |
| `tooling/*`                              | Shared tsconfig, eslint, vitest preset                                       |

## Data Flow — React Query Is The Store

**THE rule: all async/server data flows through TanStack Query. Views never fetch. Never duplicate server state in Zustand or component state.**

```
user action / effect
  → useXxx() hook (services/query/hooks)
    → packages/api function (pure HTTP)
      → queryClient.setQueryData (or cache write)
        → React Compiler-memoized components re-render
```

1. **Query keys** live in `packages/query-keys`. One entry per cached resource, with a `staleTime` constant. Mirrors the Rust `QueryKey` enum 1:1.
2. **HTTP calls** live in `packages/api`. Pure functions, `ApiClient` injected. No classes with state.
3. **Hooks** in `apps/mobile/services/query/hooks/` wrap each key with `useQuery` / `useInfiniteQuery` / `useMutation`.
4. **Persistence**: `@tanstack/query-async-storage-persister` backed by `react-native-mmkv`. Hydrated entries come back as immediately-stale → background revalidation on boot.
5. **Optimistic updates**: always `setQueryData` first, mutate, `onError` rollback. Mirrors the Rust "update both view state and cache entry" rule.
6. **Invalidation**: use query-key predicates (`queryClient.invalidateQueries({ predicate })`). Mirrors Rust `invalidate_matching`.
7. **User switch**: `queryClient.clear()`. Do not selectively invalidate — every key is already scoped by `userId`.
8. **Local downloads** are the only exception: the `downloader` Nitro module is the source of truth and pushes deltas up via `queryClient.setQueryData`.
9. **Pending playback reports** (offline queue) live in a dedicated MMKV entry, drained by `services/connection/monitor.ts` on reconnect.

## Adding a new cached data flow

1. Add a key + staleTime to `packages/query-keys`.
2. Add a pure fetch function to `packages/api` (plus a Vitest test with an MSW fixture).
3. Add a `useXxx` hook in `apps/mobile/services/query/hooks/`.
4. Consume the hook from a pure component. **Never fetch inside a component.**
5. If writes are involved, add a mutation hook with `onMutate` (optimistic) / `onError` (rollback) / `onSettled` (invalidate).

## Layered Rules

| Layer             | Where                                                      | Rules                                                                                                 |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **UI**            | `apps/mobile/features/*`                                   | Pure components: props struct + callback fields. No API calls. No navigation imports — callbacks out. |
| **Data/State**    | TanStack Query + `packages/query-keys` + `packages/models` | Single source of truth for async state.                                                               |
| **Network**       | `packages/api`                                             | HTTP only. No business logic. No state.                                                               |
| **Orchestration** | `apps/mobile/services/*`                                   | Hooks, event handlers, query wiring, connection monitor, playback reporter.                           |

## Event / callback convention

Components are **props-in, callbacks-out**. Data comes in via props, user actions flow out via `on...` callback props typed as `(...args) => void`. Components never reach into parent state, never import from `services/`, never call query hooks directly when they can receive data via props. Screens (`features/*/screens/*`) are the composition layer — they call hooks and wire callbacks.

```tsx
// features/home/components/MediaCard.tsx
type Props = {
  title: string;
  poster: string | undefined;
  progress: number | undefined;
  onPress: () => void;
  onLongPress: () => void;
};
export function MediaCard({ title, poster, progress, onPress, onLongPress }: Props) { … }
```

## Feature folders

Organize by feature, never by layer. Shared UI goes in `features/common/`.

```
features/
├─ home/      { screens, components, hooks }
├─ detail/
├─ player/
├─ search/
├─ downloads/
├─ requests/
├─ settings/
├─ profile/
└─ common/    { MediaCard, Shelf, Modal, BottomSheet, ConnectionBanner, Focusable, ... }
```

## React Compiler rules

- React Compiler is enabled in **strict** mode from day 0.
- **Never** hand-write `React.memo`, `useMemo`, `useCallback`, or `memoizeOne`. The compiler handles it.
- Callbacks passed into native modules (Nitro MPV events, downloader events) must come from `useRef`, because the compiler cannot stabilise identity across the JS↔native boundary.
- No inline object allocation in list render paths (FlashList item size estimators + React Compiler both prefer stable references).
- Run ESLint with the React Compiler rule enabled; fix warnings before merging.

## Nitro Modules

- One TS spec per module (`modules/<name>/src/index.ts`). Swift impl for iOS/tvOS/Catalyst; Kotlin for Android/Android TV.
- Hybrid objects dispose via `release()`. Always release on unmount.
- Events are named `onXxx`, delivered on the JS thread. Subscribe via refs, unsubscribe on unmount.
- Native errors surface as typed `NitroError` with a stable `code` field — JS maps to user-facing messages, never shows the raw native string.
- Every module has a platform gate in its `podspec` / `build.gradle` — Catalyst-unsupported modules (e.g. Chromecast) are excluded via `#if !targetEnvironment(macCatalyst)`.
- Document each module in `modules/<name>/README.md`: TS spec, event list, lifecycle, platform matrix.

## Performance

- **FlashList v2** for every scrollable list (shelves, grids, episode lists, downloads, search).
- **expo-image** for every image — always pass explicit `width`/`height`, `contentFit="cover"`, and a stable `recyclingKey`.
- No inline object or array allocation inside `renderItem`.
- Use `@shopify/flash-list` estimators from day 1 — don't "fix it later".
- Image cache tier set per screen (`priority="high"` on the hero, `"low"` on shelves below the fold).

## Routing

- **Expo Router** typed routes. Every `href` is type-checked.
- Groups: `(auth)` vs `(app)`. Root `_layout.tsx` redirects based on auth state.
- Deep links: `jellyfuse://detail/movie/:id`, `jellyfuse://play/:id`.
- tvOS / Android TV menu button remapped to back.
- **Nav state preservation**: custom `useRestoredScroll(routeKey)` hook. FlashList offset saved on blur, restored on focus. Mirrors the Rust `nav_state.rs` scheme.

## Player — MPV Everywhere

- All video playback goes through the `native-mpv` Nitro module. **Never** use `react-native-video` or the Expo video modules.
- Stream selection (DirectPlay / DirectStream / Transcode) happens in `services/playback/resolver.ts` against `PlaybackInfo` and `Settings`.
- Progress / start / stopped reporting happens in `services/playback/reporter.ts`, with a pending-report MMKV queue drained on reconnect. Every report includes `MediaSourceId`, `PlayMethod`, `CanSeek`.
- Trickplay thumbnails, chapter markers, intro-skipper are **JS overlays** driven by MPV `onProgress` events.
- PiP hand-off, AirPlay route, Chromecast cast-out are separate Nitro modules composed with the player screen.

## Secrets — 1Password

**Never commit secrets. Never hardcode URLs, tokens, or credentials. No `.env` file is checked in.**

- Local dev: `op inject -i .env.tpl -o .env`, or run commands under `op run -- bun run ios`.
- CI: `1password/load-secrets-action@v2` with a service-account token as the only raw GitHub Actions secret; everything else lives in the `Jellyfuse CI` vault.
- Signing certs, provisioning profiles, keystores stored as 1Password documents — pulled via `op read` / `op document get` in CI.
- `eas.json` references env vars populated from 1Password; no secrets in `eas.json` itself.
- See `docs/secrets.md` for the vault layout and `op://` reference conventions.

## Git & commits

- Trunk-based. `main` is always green. Short-lived `feat/<slug>` / `fix/<slug>` / `chore/<slug>` branches.
- **Conventional Commits** enforced by commitlint. Scope hints at the feature folder: `feat(player): ...`, `fix(downloads): ...`.
- One Linear issue = one branch = one PR. PR title starts with the Linear key.
- PR body: Summary · Test plan.
- Squash merge into main. No force-push to main. Hooks are never skipped.
- Every commit message trailer: `Refs ARK-123` (or whatever prefix the JellyFusion RN team uses).

## Testing

Three surfaces, each with the right tool:

1. **Pure TS packages** (`packages/api`, `packages/models`, `packages/query-keys`) → **Vitest**, run under Bun. MSW for HTTP mocks; fixtures under `packages/api/__fixtures__/`. Every public API function has a test.
2. **Hooks and non-UI app logic** (`services/query/hooks`, `services/playback/resolver`, `services/playback/reporter`) → **Jest** + `@testing-library/react-hooks`.
3. **Components** (`features/*/components/*`) → **Jest + React Native Testing Library**. Interaction tests, not snapshots.
4. **Native modules** → XCTest (Swift) / JUnit + Robolectric (Kotlin), focused on downloader state machine + MPV property wiring.

When touching:

- `packages/api` → add/update a Vitest test with a fixture.
- A hook in `services/` → add a Jest test.
- A component → add an RTL interaction test.
- A Nitro module → add a native unit test.

CI fails if a touched file's coverage drops vs the previous run.

## Claude collaboration preferences

These are the rules Claude must follow when working in this repo. They override default behaviour.

1. **No dead code or scaffolding.** Don't write code that isn't wired end-to-end. No unused exports, no half-implemented hooks, no "// TODO wire up" placeholders.
2. **Fix all warnings in new/modified code before reporting done.** TypeScript, ESLint, React Compiler, oxfmt — all green.
3. **Don't launch simulators for the user.** The user runs `bun run ios` / `android` / `tv:*` / `catalyst` themselves and reports back. Your job ends at "ready to test".
4. **Use scripts, not raw tools.** `bun run prebuild`, `bun run xcodegen`, etc. — never invoke the underlying binaries directly when a script exists.
5. **Thorough planning.** Plans cover UX flows, edge cases, forward-looking decisions — not just file structure. When in doubt, plan first and ask.
6. **Pure components. Feature folders. DRY. React Query data pattern.** Enforced above; repeated here because they're the rules most often violated.
7. **Components first.** Before creating inline UI, check `features/common/` for an existing component. Reuse over duplicate.
8. **No manual memoization.** See React Compiler rules above.
9. **No raw `fetch`, no `react-native-video`, no direct API calls from views, no untyped routes, no Prettier.** These are hard bans.
10. **Secrets via 1Password only.** Never paste a token, URL, or password into a file. Use `op://` references in `.env.tpl`.
11. **Read the Rust spec when porting a feature.** The Rust codebase at `../fusion` is the authoritative behavioural spec — `crates/jf-core/src/{models,query,state}.rs`, `crates/jf-api/src/{jellyfin,jellyseerr}.rs`, `crates/jf-module-player/src/backend.rs`, `crates/jf-module-download/src/*`.

## Toolchain versions

- **TypeScript 7** via `@typescript/native-preview` (`tsgo`). Drop-in replacement for `tsc`. All typecheck scripts invoke `tsgo -p tsconfig.json --noEmit`. **Never install plain `typescript`** — it'll shadow the native preview.
- **Formatter**: oxfmt (Rust). **Never Prettier.**
- **Bun** ≥ 1.3 as package manager + script runner.
- **Node** ≥ 20 (for tooling that still shells out).

## What NOT to do

- No `react-native-video`. MPV only.
- No `fetch` — use Nitro Fetch via `packages/api`.
- No Prettier — use oxfmt.
- No `typescript` package — use `@typescript/native-preview` / `tsgo`.
- No `useMemo` / `useCallback` / `React.memo` — React Compiler handles it.
- No direct API calls from components. Use hooks.
- No untyped routes. Expo Router typed routes only.
- No duplicate server state. If it's on the server, it lives in TanStack Query.
- No plaintext secrets in the repo. 1Password is the source of truth.
- No force-push to `main`. No skipping hooks.
- No scaffolding without wiring it end-to-end.
