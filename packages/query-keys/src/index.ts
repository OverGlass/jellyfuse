// @jellyfuse/query-keys — TanStack Query key factory + stale times.
// 1:1 port of `crates/jf-core/src/query.rs::QueryKey` + `stale_time()`.
// Every home/detail/search variant from the Rust enum has a TS factory
// here so the mobile app and the future web app share the same keys.

/**
 * Centralised stale times (ms), mirroring `QueryKey::stale_time()` in Rust.
 * Grouped by resource family. Use via `STALE_TIMES.xxx` at the hook
 * call-site — never inline magic numbers.
 */
export const STALE_TIMES = {
  /** System info / server version — effectively static per session. */
  systemInfo: 60 * 60 * 1000,

  /** Continue Watching / Next Up — 60 s (Rust: 60 s). */
  continueWatching: 60 * 1000,
  nextUp: 60 * 1000,

  /** Recently Added / Latest Movies / Latest TV — 5 min (Rust: 300 s). */
  recentlyAdded: 5 * 60 * 1000,
  latestMovies: 5 * 60 * 1000,
  latestTv: 5 * 60 * 1000,

  /** Suggestions / Requests — 2 min (Rust: 120 s). */
  suggestions: 2 * 60 * 1000,
  requests: 2 * 60 * 1000,

  /** Movie / series detail — 2 min (Rust: 120 s). */
  movieDetail: 2 * 60 * 1000,
  seriesDetail: 2 * 60 * 1000,

  /** Season / episode lists — 5 min (Rust: 300 s). */
  seasonEpisodes: 5 * 60 * 1000,
  seasonInfo: 10 * 60 * 1000,

  /** Radarr/Sonarr download progress — 10 s (polled via refetchInterval). */
  downloadProgress: 10 * 1000,

  /** Quality profiles — 30 min (Rust: 1800 s). */
  qualityProfiles: 30 * 60 * 1000,

  /** TMDB TV seasons (incl. mediaInfo status) — 5 min. */
  tmdbTvSeasons: 5 * 60 * 1000,

  /** TMDB-only detail (Jellyseerr items not yet in library) — 2 min. */
  tmdbDetail: 2 * 60 * 1000,

  /** Search — 30 s (Rust: 30 s). */
  search: 30 * 1000,

  /**
   * Per-user configuration persisted on the Jellyfin server. Rarely
   * changes (user must actively toggle in Settings); refetching more
   * often than once an hour is wasteful. Invalidated explicitly on
   * every successful `updateUserConfiguration` call.
   */
  userConfiguration: 60 * 60 * 1000,
} as const;

export type StaleTimeKey = keyof typeof STALE_TIMES;

/**
 * Root key factory. Every data key is scoped by `userId` (the active
 * Jellyfin user) so `queryClient.clear()` on user switch is the right
 * invalidation — no per-key cleanup required. See CLAUDE.md "User switch".
 *
 * Key shapes are stable arrays so TanStack Query's structural equality
 * works without extra effort. `as const` is important — it makes each
 * literal readonly, which fixes RQ's cache hit rate when keys flow
 * through React Compiler's auto-memoisation.
 */
export const queryKeys = {
  systemInfo: (baseUrl: string) => ["system-info", baseUrl] as const,

  // Home shelves -------------------------------------------------------
  continueWatching: (userId: string) => ["home", userId, "continue-watching"] as const,
  nextUp: (userId: string) => ["home", userId, "next-up"] as const,
  recentlyAdded: (userId: string) => ["home", userId, "recently-added"] as const,
  latestMovies: (userId: string) => ["home", userId, "latest-movies"] as const,
  latestTv: (userId: string) => ["home", userId, "latest-tv"] as const,
  suggestions: (userId: string) => ["home", userId, "suggestions"] as const,
  requests: (userId: string) => ["home", userId, "requests"] as const,

  // Shelf "see all" infinite grid (Phase 2e) ---------------------------
  shelfPage: (userId: string, shelfKey: ShelfKey) => ["shelf", userId, shelfKey] as const,

  // Detail -------------------------------------------------------------
  movieDetail: (userId: string, jellyfinId: string) =>
    ["detail", userId, "movie", jellyfinId] as const,
  seriesDetail: (userId: string, jellyfinId: string) =>
    ["detail", userId, "series", jellyfinId] as const,
  /** TMDB-only detail (Jellyseerr items not yet in library). */
  tmdbDetail: (userId: string, tmdbId: number, mediaType: "movie" | "tv") =>
    ["detail", userId, "tmdb", tmdbId, mediaType] as const,
  seasonEpisodes: (userId: string, seasonId: string) =>
    ["detail", userId, "season-episodes", seasonId] as const,
  /** Next episode after a given episode — used by player autoplay. */
  adjacentEpisode: (userId: string, seriesId: string, episodeId: string) =>
    ["detail", userId, "adjacent-episode", seriesId, episodeId] as const,
  seasonInfo: (userId: string, tmdbId: number) =>
    ["detail", userId, "season-info", tmdbId] as const,

  // Playback (Phase 3) / Requests (Phase 4) ----------------------------
  playbackInfo: (userId: string, itemId: string) => ["playback", userId, "info", itemId] as const,
  introSkipper: (itemId: string) => ["playback", "intro-skipper", itemId] as const,
  trickplayInfo: (itemId: string) => ["playback", "trickplay", itemId] as const,
  downloadProgress: (tmdbId: number) => ["download-progress", tmdbId] as const,
  downloadProgressMap: (userId: string) => ["download-progress-map", userId] as const,
  jellyseerrRequests: (userId: string) => ["jellyseerr-requests", userId] as const,
  qualityProfiles: (service: "radarr" | "sonarr") => ["quality-profiles", service] as const,
  tmdbTvSeasons: (tmdbId: number) => ["tmdb-tv-seasons", tmdbId] as const,
  search: (userId: string, query: string) => ["search", userId, query] as const,

  // Local downloads (Phase 5) — sourced from the downloader Nitro
  // module, not persisted through the RQ persister.
  localDownloads: (userId: string) => ["local-downloads", userId] as const,
  localDownload: (userId: string, jellyfinId: string, mediaSourceId: string) =>
    ["local-downloads", userId, jellyfinId, mediaSourceId] as const,

  // User configuration — server-persisted preferences (audio language,
  // subtitle mode, autoplay, etc.). Scoped by userId like every other
  // per-user query so `queryClient.clear()` on switch is safe.
  userConfiguration: (userId: string) => ["user-configuration", userId] as const,

  // Transient slot for the `MediaItem` pending in the quality-picker
  // formSheet screen. Written by `useItemDownload` before navigating;
  // read by the sheet to avoid re-plumbing the full MediaItem through
  // route params. Cleared on sheet dismiss.
  pendingDownload: (jellyfinId: string) => ["pending-download", jellyfinId] as const,
} as const;

/**
 * Shelf key union — stays narrow so typed routes at `/shelf/[shelfKey]`
 * can enforce it. Add a new value here **and** the matching query-keys
 * factory above when wiring a new shelf.
 */
export type ShelfKey =
  | "continue-watching"
  | "next-up"
  | "recently-added"
  | "latest-movies"
  | "latest-tv"
  | "suggestions"
  | "requests";
