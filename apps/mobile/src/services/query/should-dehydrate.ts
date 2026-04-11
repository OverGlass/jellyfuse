import type { Query } from "@tanstack/react-query";

/**
 * Predicate that decides whether a query should be serialised into the
 * MMKV persister. Exists as a pure function so it is trivially unit-
 * testable — `apps/mobile/src/services/query/should-dehydrate.test.ts`
 * covers the matrix of persisted/excluded keys + status values.
 *
 * ## Rules (ported from the Rust `QueryKey::persist_key` helper)
 *
 * **Persisted** — cold-launch reload matters:
 * - `home/*` — every home shelf (continue-watching, next-up,
 *   recently-added, latest-movies, latest-tv, suggestions, requests)
 * - `detail/*` — movie / series / tmdb detail + season episodes
 * - `system-info` — long stale, fine to cache
 * - `quality-profiles` — 30 min stale
 * - `shelf/*` — infinite "see all" pages (Phase 2e)
 *
 * **Excluded** — never persist through RQ:
 * - `auth/*` — lives in secure-storage (Phase 1), not the persister
 * - `playback/*` — PlaybackInfo is volatile, driven by the resolver
 *   at playback time (Phase 3)
 * - `download-progress*` — 10s stale, pointless to cache
 * - `local-downloads/*` — source of truth is the downloader Nitro
 *   module's on-disk manifest (Phase 5), not RQ
 * - `search/*` — ephemeral, matches Rust `Search { query } -> None`
 *
 * **Status filter**: only `success` queries are dehydrated. Errors
 * and pending states would rehydrate as stale errors and confuse the
 * stale-while-revalidate flow on next boot.
 */
export function shouldDehydrateQuery(query: Query): boolean {
  if (query.state.status !== "success") return false;

  const topLevel = query.queryKey[0];
  if (typeof topLevel !== "string") return false;

  switch (topLevel) {
    case "system-info":
    case "home":
    case "detail":
    case "shelf":
    case "quality-profiles":
      return true;

    case "auth":
    case "playback":
    case "download-progress":
    case "download-progress-map":
    case "local-downloads":
    case "search":
      return false;

    default:
      // Unknown top-level key — be conservative and skip persistence.
      // Bump `PERSISTED_SCHEMA_VERSION` + add a case here when a new
      // query family arrives.
      return false;
  }
}
