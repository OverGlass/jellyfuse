// @jellyfuse/models — domain types ported from the Rust crate `jf-core`.
// Phase 0a ships a single marker type; Phase 1 begins the full port from
// crates/jf-core/src/models.rs (MediaItem, PlaybackInfo, DownloadRecord,
// PendingReport, Settings, Chapter, TrickplayInfo, IntroSkipperSegments,
// SubtitleTrack, JellyfinUser, AuthenticatedUser).

/** Monorepo-wide version marker to prove the package is wired. */
export const MODELS_PACKAGE_VERSION = "0.0.0" as const
