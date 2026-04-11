// @jellyfuse/query-keys — TanStack Query key factory + stale times.
// Mirrors crates/jf-core/src/query.rs 1:1. Phase 0a ships the scaffolding and
// a single example key so tests can verify stale-time conventions are in place.
// Phase 2 ports every QueryKey variant.

/** Centralised stale times, keyed by resource family. Expressed in ms. */
export const STALE_TIMES = {
  /** System info / server version — effectively static per session. */
  systemInfo: 60 * 60 * 1000,
  /** Home shelves — short stale, background revalidated on focus. */
  homeShelf: 2 * 60 * 1000,
  /** Quality profiles — 30 minutes (matches Rust). */
  qualityProfiles: 30 * 60 * 1000,
  /** Radarr/Sonarr download progress — 10 s (polled via refetchInterval). */
  downloadProgress: 10 * 1000,
} as const

export type StaleTimeKey = keyof typeof STALE_TIMES

/**
 * Root key factory. Every key is scoped by userId so `queryClient.clear()`
 * on user switch is sufficient — see CLAUDE.md "User switch" rule.
 */
export const queryKeys = {
  systemInfo: (baseUrl: string) => ["system-info", baseUrl] as const,
  home: (userId: string) => ["home", userId] as const,
  qualityProfiles: () => ["quality-profiles"] as const,
} as const
