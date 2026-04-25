# Jellyseerr disconnection — handling plan

## Context

When a Jellyseerr session expires (cookie rotated, server restarted, idle timeout), the app currently has no detection and no recovery. Symptoms surface as opaque "search failed" / "request failed" errors with `jellyseerrStatus` still reading `"connected"` in `useAuth()` because the cookie value remains in persisted-auth. The user has to dig into Settings and tap **Reconnect** manually.

The plumbing already exists end-to-end — it's just not connected:

- `apps/mobile/src/services/jellyseerr/client.ts` — `jellyseerrFetch` already injects the `connect.sid` cookie and throws a typed `JellyseerrSessionExpiredError` on 401.
- `apps/mobile/src/features/settings/components/jellyseerr-reconnect-modal.tsx` — full reconnect UX, takes `initialError`, calls `reconnectJellyseerr`.
- `apps/mobile/src/services/auth/state.tsx` — `reconnectJellyseerr` mutation, `JELLYSEERR_LAST_ERROR_KEY` query for surfacing the seed error to the modal.

Three gaps:

1. **The actual API callers bypass `jellyseerrFetch`** — `use-search-blended.ts`, `use-requests.ts`, `use-request-flow.ts` all pass the raw `apiFetch` to `fetchJellyseerr*`. Cookies do auto-attach via URLSession's shared store, but no 401 → typed-error mapping happens. The whole 401-detection layer is dead code right now.
2. **Disconnection isn't propagated** — even if a caller did detect 401, nothing clears `activeUser.jellyseerrCookie` or stamps `JELLYSEERR_LAST_ERROR_KEY`. So `jellyseerrStatus` stays `"connected"` and downstream hooks keep firing requests that 401 again.
3. **Reconnect prompt is settings-only** — the user has to navigate to Settings → Jellyseerr row → modal. There's no banner on the screens where the failure actually surfaces (Home search, Requests, detail Request flow).

## Goal

Make Jellyseerr disconnection a first-class state. When a 401 happens anywhere:

- The user sees an actionable banner on the screen they're on, with a one-tap **Reconnect** that opens the existing modal.
- No further Jellyseerr requests fire until the cookie is refreshed.
- Library-only flows (Jellyfin search, Jellyfin shelves) keep working — disconnection is partial, not total.

## Plan

### M1 — Wire 401 detection through every Jellyseerr caller

**Files**: `apps/mobile/src/services/query/hooks/{use-search-blended,use-requests,use-request-flow}.ts`.

Replace the `apiFetch` arguments with a new `jellyseerrFetchAware(jellyseerrUrl)` helper that:

1. Wraps `nitroFetch` with the same cookie-injection that `jellyseerrFetch` does today, but pulls the cookie via the function arg rather than reading the cache (these hooks already have the active user context). One source of truth for "Jellyseerr request" lives in `services/jellyseerr/client.ts`.
2. Maps 401 → `JellyseerrSessionExpiredError`.

Alternative: just route them through the existing `jellyseerrFetch` — it already reads the cookie from the cache. Simpler. **Pick this**.

Audit: every fetcher in `packages/api/src/jellyseerr.ts` + `packages/api/src/search.ts` (`fetchJellyseerrSearch`, `fetchJellyseerrRequests`, `fetchTmdbTvSeasons`, `fetchQualityProfiles`, `createJellyseerrRequest`, `mapJellyseerrSearchResponse` callers). Anything taking the `apiFetch` parameter on the Jellyseerr side switches to `jellyseerrFetch`.

**Critical files**:

- `apps/mobile/src/services/query/hooks/use-search-blended.ts` line 109 — swap `apiFetch` → `jellyseerrFetch`.
- `apps/mobile/src/services/query/hooks/use-requests.ts` — same swap.
- `apps/mobile/src/services/query/hooks/use-request-flow.ts` — three callsites.

**DoD**: Manually expire a cookie (e.g. revoke session in Jellyseerr admin → tap Search) → the hook surfaces `JellyseerrSessionExpiredError` instead of a generic 401 status.

### M2 — Centralise the disconnect handler

**Files**: new `apps/mobile/src/services/jellyseerr/disconnect-monitor.ts`, edits to `apps/mobile/src/services/auth/state.tsx`.

Add a single function `handleJellyseerrSessionExpired(reason: string)` that:

1. Reads the active user from the auth cache.
2. Writes back the user with `jellyseerrCookie: null` (clears the marker → `jellyseerrStatus` flips to `"disconnected"`).
3. Sets `JELLYSEERR_LAST_ERROR_KEY` data to the localised `settings.jellyseerr.defaultError` (already in i18n catalog) or the actual server message if available.
4. Cancels in-flight Jellyseerr queries via `queryClient.cancelQueries({ predicate: q => q.queryKey.includes('jellyseerr') })` to stop noisy retries.

Wire it from `useQueries` `onError` in each Jellyseerr query — or, simpler, install a single TanStack Query `QueryCache` listener at the QueryProvider level that filters for `JellyseerrSessionExpiredError` and dispatches the handler. **Prefer the global listener** — it's one wiring point, covers every query, and keeps the hooks readable.

**Critical files**:

- `apps/mobile/src/services/query/index.ts` — install `queryCache.subscribe` listener that detects `JellyseerrSessionExpiredError` and calls the handler.
- `apps/mobile/src/services/auth/state.tsx` — export `handleJellyseerrSessionExpired` alongside the existing `reconnectJellyseerr`.

**DoD**: After a 401, `useAuth().jellyseerrStatus === "disconnected"` and Jellyseerr-dependent queries stop firing.

### M3 — Reusable reconnect banner + prompt routing

**Files**: new `apps/mobile/src/features/common/components/jellyseerr-reconnect-banner.tsx`, edits to `home-screen.tsx`, `requests-screen.tsx`, `request-flow-screen.tsx`.

Component contract: pure props-in / callback-out, mirrors `ConnectionBanner`:

```tsx
type Props = {
  /** Whether the banner is shown — derived from useAuth().jellyseerrStatus. */
  visible: boolean;
  /** Last server-reported error to seed the banner subtitle. */
  errorMessage?: string;
  onReconnect: () => void;
  onDismiss?: () => void;
};
```

Banner copy comes from existing i18n keys (`settings.jellyseerr.reconnect.title`, `settings.jellyseerr.defaultError`); add `common.jellyseerr.bannerCta` = "Reconnect".

Mounting:

- **Home screen** — render above the search list when `jellyseerrStatus === "disconnected"` AND `jellyseerrUrl` is set. Tap → push to `/(app)/jellyseerr-reconnect` route or open the modal in-place.
- **Requests screen** — same banner above the empty/list states.
- **Request flow modal (formSheet)** — block submission with the reconnect CTA when disconnected mid-flow.

The reconnect modal already exists in Settings — promote it from the settings folder to a shared sheet route so the banner can route to it without a Settings detour. Or keep it where it is and just open via `setPicker("jellyseerrReconnect")` after navigating to Settings.

**Picking a UX**: lift the modal to a typed Expo Router formSheet at `app/(app)/jellyseerr-reconnect.tsx`. Then the banner deep-links there and Settings opens the same route. One mount path, no double-mounted modal state.

**Critical files**:

- new `apps/mobile/src/app/(app)/jellyseerr-reconnect.tsx` — Expo Router formSheet host wrapping the existing modal component.
- `apps/mobile/src/features/settings/screens/settings-screen.tsx` — replace inline `<JellyseerrReconnectModal>` with `router.push("/jellyseerr-reconnect")`.
- `apps/mobile/src/features/home/screens/home-screen.tsx` and `requests-screen.tsx` — mount `<JellyseerrReconnectBanner>` and route on tap.

**DoD**: 401 → banner appears on the active screen → tap → modal opens → user enters password → `reconnectJellyseerr` mutation refreshes the cookie → banner disappears, queries auto-resume.

### M4 — Tests + tightening

**Files**: `apps/mobile/src/services/jellyseerr/__tests__/disconnect-monitor.test.ts`, plus a new fixture in `packages/api`.

- Vitest covering `handleJellyseerrSessionExpired`: given a persisted-auth, after the call, the active user has `jellyseerrCookie === null` and the last-error query is set.
- Jest interaction test for the banner: given `jellyseerrStatus === "disconnected"` + `jellyseerrUrl` set, banner renders and `onReconnect` fires on tap.
- Update `useSearchBlended` test (if any) to cover the 401 → settled-with-empty path now that 401 maps to `JellyseerrSessionExpiredError`.

Performance / hygiene:

- Set `retry: 0` on every Jellyseerr query (already done for search — confirm for requests + request-flow).
- The reconnect mutation's `onSuccess` already re-validates queries (confirm in `state.tsx`); if not, invalidate `["jellyseerr"]` predicate so home/requests refetch.

**DoD**: `bun run test` green, manual flow E2E.

## Verification

End-to-end manual scenario (per CLAUDE.md user runs the app, AI does not launch sims):

1. Sign in to Jellyseerr via Settings.
2. Force a session expiry — easiest is restarting the Jellyseerr server, or revoking the session from the Jellyseerr admin UI.
3. Open the home screen → trigger a search.
4. **Expected**: banner appears at the top of the home screen with "Jellyseerr session expired — Reconnect". Library results still render below it.
5. Tap **Reconnect** → modal opens with username pre-filled.
6. Enter password → mutation runs → modal dismisses → banner disappears.
7. Search auto-refetches → Jellyseerr results return.

## Rollout order

M1 and M2 can ship together as one PR (both touch the data layer, no UX surface). M3 ships as a separate UX PR. M4 lands incrementally with each PR. Total estimate: ~half a day for M1 + M2, ~half a day for M3.

## Open questions

- Auto-attempt silent reconnect when the previous password is recoverable (e.g. piggyback Jellyfin's password)? **No** — Jellyseerr passwords aren't necessarily the same as Jellyfin's, and silent reconnect creates a phishing-resistant footgun. Always require explicit user confirmation.
- Should we proactively ping `/api/v1/auth/me` on app foreground to detect expiry early? Probably yes as a follow-up, but not in scope here.
