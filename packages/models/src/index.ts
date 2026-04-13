// @jellyfuse/models — domain types ported from `crates/jf-core/src/models.rs`.
// Kept framework-agnostic so `@jellyfuse/api`, `apps/mobile`, and the future
// `apps/web` all consume the same shape. No runtime code besides narrow
// type-guard helpers that are cheap to ship to every consumer.

/** Monorepo-wide version marker to prove the package is wired. */
export const MODELS_PACKAGE_VERSION = "0.0.1" as const;

// ──────────────────────────────────────────────────────────────────────────────
// Identity
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A media item can originate from Jellyfin (library), Jellyseerr/TMDB
 * (requestable), or both (present in library **and** matched to a TMDB id).
 * Mirrors the Rust `MediaId` enum 1:1.
 */
export type MediaId =
  | { kind: "jellyfin"; jellyfinId: string }
  | { kind: "tmdb"; tmdbId: number }
  | { kind: "both"; jellyfinId: string; tmdbId: number };

export function mediaIdJellyfin(id: MediaId): string | undefined {
  return id.kind === "jellyfin" || id.kind === "both" ? id.jellyfinId : undefined;
}

export function mediaIdTmdb(id: MediaId): number | undefined {
  return id.kind === "tmdb" || id.kind === "both" ? id.tmdbId : undefined;
}

// ──────────────────────────────────────────────────────────────────────────────
// Enumerations
// ──────────────────────────────────────────────────────────────────────────────

export type MediaSource = "jellyfin" | "jellyseerr" | "both";

export type MediaType =
  | "movie"
  | "series"
  | "episode"
  | "season"
  | "music"
  | "musicAlbum"
  | "collection";

export type RequestStatus = "pending" | "approved" | "declined" | "available";

export type Availability =
  | { kind: "available" }
  | { kind: "requested"; status: RequestStatus }
  | { kind: "missing" };

// ──────────────────────────────────────────────────────────────────────────────
// Jellyfin user playback data
// ──────────────────────────────────────────────────────────────────────────────

export interface UserItemData {
  played: boolean;
  playCount: number;
  /** Resume point in Jellyfin ticks (10,000 ticks = 1 ms). */
  playbackPositionTicks: number;
  isFavorite: boolean;
  lastPlayedDate: string | undefined;
}

// ──────────────────────────────────────────────────────────────────────────────
// Unified media item
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Single type bridging Jellyfin library items and Jellyseerr/TMDB results.
 * Used in every view — MediaCard, detail page, search results. Mirrors
 * `crates/jf-core/src/models.rs::MediaItem`.
 */
export interface MediaItem {
  id: MediaId;
  source: MediaSource;
  availability: Availability;
  mediaType: MediaType;

  title: string;
  sortTitle: string | undefined;
  year: number | undefined;
  overview: string | undefined;

  /** Primary image URL (fully qualified). */
  posterUrl: string | undefined;
  backdropUrl: string | undefined;
  logoUrl: string | undefined;

  genres: string[];
  /** 0–10 community rating. */
  rating: number | undefined;

  /** 0–1 resume progress, derived from `UserData.PlayedPercentage`. */
  progress: number | undefined;

  runtimeMinutes: number | undefined;
  userData: UserItemData | undefined;

  // Series / episode metadata -----------------------------------------------
  seasonCount: number | undefined;
  episodeCount: number | undefined;
  seriesName: string | undefined;
  seasonNumber: number | undefined;
  episodeNumber: number | undefined;
  seriesId: string | undefined;
}

/**
 * Output of the blended Jellyfin + Jellyseerr search. Mirrors the Rust
 * `BlendedSearchResults` in `crates/jf-core/src/state.rs`: two flat
 * arrays so the UI can present library and requestable items as
 * separate sections without re-computing the split.
 */
export interface BlendedSearchResults {
  /** Items already in the Jellyfin library — immediately playable. */
  libraryItems: MediaItem[];
  /** Jellyseerr-only items that can be requested. */
  requestableItems: MediaItem[];
}

// ──────────────────────────────────────────────────────────────────────
// Jellyseerr request flow — quality profiles, seasons, request payload
// ──────────────────────────────────────────────────────────────────────

/**
 * One quality profile slot on a Radarr or Sonarr server, returned by
 * Jellyseerr's `/api/v1/service/{type}/{serverId}` endpoint.
 */
export interface QualityProfile {
  id: number;
  name: string;
}

/**
 * One Radarr / Sonarr server registered in Jellyseerr, with its
 * available quality profiles + the server-default profile id (used
 * to pre-select an option in the request modal).
 */
export interface MediaServer {
  id: number;
  name: string;
  profiles: QualityProfile[];
  /** `id` of the profile Jellyseerr considers the active default. */
  defaultProfileId: number | undefined;
}

/** Per-season status returned by `GET /api/v1/tv/{tmdbId}`. */
export type SeasonAvailability = "available" | "requested" | "missing";

/**
 * One season of a TV show as the request modal sees it. Mirrors the
 * Rust `SeasonInfo` in `crates/jf-core/src/models.rs`. Built by
 * combining the TMDB `seasons[]` array with the Jellyseerr
 * `mediaInfo.seasons[].status` and `mediaInfo.requests[].seasons`
 * lists.
 */
export interface SeasonInfo {
  seasonNumber: number;
  name: string;
  availability: SeasonAvailability;
}

/** `"S2 · E4"` for episodes, `undefined` otherwise. */
export function episodeLabel(item: MediaItem): string | undefined {
  if (item.seasonNumber !== undefined && item.episodeNumber !== undefined) {
    return `S${item.seasonNumber} · E${item.episodeNumber}`;
  }
  if (item.seasonNumber !== undefined) {
    return `S${item.seasonNumber}`;
  }
  return undefined;
}

/** `"2023 · 2h 15m"` or `"2023 · 3 Seasons"` — mirrors Rust `MediaItem::subtitle`. */
export function mediaItemSubtitle(item: MediaItem): string {
  const parts: string[] = [];
  if (item.year !== undefined) {
    parts.push(String(item.year));
  }
  if (item.runtimeMinutes !== undefined) {
    parts.push(formatRuntime(item.runtimeMinutes));
  } else if (item.seasonCount !== undefined) {
    parts.push(`${item.seasonCount} ${item.seasonCount === 1 ? "Season" : "Seasons"}`);
  }
  return parts.join(" · ");
}

function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Playback — ported from `crates/jf-core/src/models.rs`
// ──────────────────────────────────────────────────────────────────────────────

export type PlayMethod = "DirectPlay" | "DirectStream" | "Transcode";

export type SubtitleMode = "Off" | "OnlyForced" | "Always";

export interface AudioStream {
  /** Jellyfin stream index. */
  index: number;
  language: string | undefined;
  displayTitle: string;
  codec: string;
  channels: number | undefined;
  isDefault: boolean;
}

export interface SubtitleTrack {
  /** Jellyfin stream index. */
  index: number;
  language: string | undefined;
  displayTitle: string;
  codec: string | undefined;
  isDefault: boolean;
  isForced: boolean;
  /** Absolute URL for external subtitles (srt/vtt/ass). Undefined for embedded. */
  deliveryUrl: string | undefined;
}

export interface Chapter {
  /** Start position in Jellyfin ticks (10,000 ticks = 1 ms). */
  startPositionTicks: number;
  name: string;
}

export interface TrickplayInfo {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  thumbnailCount: number;
  /** Milliseconds between thumbnails. */
  interval: number;
}

export interface SkipSegment {
  /** Seconds. */
  start: number;
  /** Seconds. */
  end: number;
}

export interface IntroSkipperSegments {
  introduction: SkipSegment | undefined;
  recap: SkipSegment | undefined;
  credits: SkipSegment | undefined;
}

/**
 * Parsed result from `POST /Items/{id}/PlaybackInfo`. Contains
 * everything the resolver needs to decide how to play.
 */
export interface PlaybackInfo {
  mediaSourceId: string;
  playSessionId: string;
  method: PlayMethod;
  streamUrl: string;
  subtitles: SubtitleTrack[];
  audioStreams: AudioStream[];
  /** Total duration in Jellyfin ticks. */
  durationTicks: number;
  trickplay: TrickplayInfo | undefined;
  chapters: Chapter[];
}

/**
 * Output of the playback resolver — everything `NativeMpv.load()`
 * and the playback reporter need.
 */
export interface ResolvedStream {
  streamUrl: string;
  playMethod: PlayMethod;
  mediaSourceId: string;
  playSessionId: string;
  /** Selected audio stream index, or undefined for mpv auto-select. */
  audioStreamIndex: number | undefined;
  /** Selected subtitle stream index, or undefined for none. */
  subtitleStreamIndex: number | undefined;
  /** External subtitle URL if applicable. */
  subtitleDeliveryUrl: string | undefined;
  /** All available audio streams for the track picker UI. */
  audioStreams: AudioStream[];
  /** All available subtitle tracks for the track picker UI. */
  subtitleTracks: SubtitleTrack[];
  /** Duration in seconds. */
  durationSeconds: number;
  chapters: Chapter[];
  trickplay: TrickplayInfo | undefined;
  introSkipperSegments: IntroSkipperSegments | undefined;
}

// ──────────────────────────────────────────────────────────────────────────────
// Playback reporting — ported from `crates/jf-core/src/models.rs::PendingReport`
// ──────────────────────────────────────────────────────────────────────────────

export type PendingReportKind =
  | { type: "start"; positionTicks: number; playMethod: PlayMethod }
  | { type: "progress"; positionTicks: number; isPaused: boolean; playMethod: PlayMethod }
  | { type: "stopped"; positionTicks: number };

export interface PendingReport {
  itemId: string;
  playSessionId: string;
  mediaSourceId: string;
  kind: PendingReportKind;
  /** Unix milliseconds — used as sort key for FIFO ordering. */
  occurredAtMs: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tick helpers
// ──────────────────────────────────────────────────────────────────────────────

const TICKS_PER_SECOND = 10_000_000;

export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}
