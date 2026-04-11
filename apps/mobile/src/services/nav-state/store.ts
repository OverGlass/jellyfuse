import { storage } from "@/services/query/storage";

/**
 * MMKV-backed nav-state store. Remembers scroll offsets keyed by
 * `routeKey` (full path incl. params, e.g. `/shelf/latest-movies`)
 * so back-nav restores the previous position.
 *
 * This is pure UI state — not React Query. It lives on the same
 * MMKV instance as the RQ persister but under its own key prefix
 * so the persister's `buster` doesn't accidentally wipe it. The
 * nav-state schema is simple enough that it doesn't need its own
 * version; if we ever break the shape, bumping `NAV_STATE_KEY_PREFIX`
 * is equivalent to a hard reset.
 *
 * Mirrors `crates/jf-ui-kit/src/nav_state.rs` in the Rust impl.
 */

const NAV_STATE_KEY_PREFIX = "nav-state:v1:";

export interface ScrollState {
  /** Scroll offset in dp (or px on the native side — same unit). */
  offset: number;
}

/** Read the scroll state for a route, or `undefined` if none saved. */
export function readScrollState(routeKey: string): ScrollState | undefined {
  const raw = storage.getString(NAV_STATE_KEY_PREFIX + routeKey);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<ScrollState>;
    if (typeof parsed.offset !== "number") return undefined;
    return { offset: parsed.offset };
  } catch {
    return undefined;
  }
}

/** Write the scroll state for a route. */
export function writeScrollState(routeKey: string, state: ScrollState): void {
  storage.set(NAV_STATE_KEY_PREFIX + routeKey, JSON.stringify(state));
}

/** Drop a single route's scroll state. */
export function clearScrollState(routeKey: string): void {
  storage.remove(NAV_STATE_KEY_PREFIX + routeKey);
}

/**
 * Drop every nav-state entry. Called on user switch + sign-out so
 * stale offsets from the previous user don't leak across accounts —
 * mirrors the `queryClient.clear()` rule for server state.
 */
export function clearAllScrollStates(): void {
  const keys = storage.getAllKeys().filter((k) => k.startsWith(NAV_STATE_KEY_PREFIX));
  for (const key of keys) {
    storage.remove(key);
  }
}
