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
 * Discrete request status ported from `crates/jf-core/src/models.rs`.
 * Maps from Jellyseerr's numeric `status` codes: 2 → pending, 3 →
 * approved, 5 → available, everything else → declined.
 */
export type MediaRequestStatus = "pending" | "approved" | "available" | "declined";

/**
 * One entry in the Jellyseerr requests list, mirroring the Rust
 * `MediaRequest` in `crates/jf-core/src/models.rs`. Built from
 * `GET /api/v1/request?take=…&skip=…&sort=added` and enriched with
 * an optional `downloadProgress` patched in by `useDownloadProgressMap`
 * once Radarr / Sonarr has started the download.
 */
export interface MediaRequest {
  id: number;
  status: MediaRequestStatus;
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  posterUrl: string | undefined;
  requestedBy: string;
  createdAt: string | undefined;
  /** Empty = all seasons (or not a TV show). */
  seasons: number[];
  downloadProgress: DownloadProgress | undefined;
  /**
   * Jellyfin media ID extracted from Jellyseerr `mediaInfo.jellyfinMediaId`.
   * Populated only when the item is `available` (status 5) — Jellyseerr
   * records this after syncing the item into the library. When present, tap
   * navigation should route to the Jellyfin detail page rather than the
   * TMDB-only detail, mirroring the Rust `detail_path(MediaId::Both)` rule.
   */
  jellyfinMediaId: string | undefined;
}

/**
 * Aggregated download state for one request's underlying Radarr /
 * Sonarr queue entries. Mirrors `crates/jf-core/src/models.rs::DownloadProgress`.
 *
 * - `fraction: number` in the range `[0, 1]` when Radarr/Sonarr is
 *   actively downloading and reporting `size` + `sizeLeft`. Computed
 *   as `Σ(size - sizeLeft) / Σ(size)` across every queue entry for
 *   the TMDB id.
 * - `fraction === -1` is the "queued with no bytes yet" sentinel —
 *   Radarr has accepted the request but hasn't started pulling the
 *   file yet, so the UI should render an indeterminate indicator
 *   instead of a percent-filled bar.
 * - `timeLeft` is Radarr's human-readable ETA string (e.g. `"2h 30m"`).
 */
export interface DownloadProgress {
  fraction: number;
  status: string;
  timeLeft: string | undefined;
}

/**
 * Convert a `MediaRequest` to a `MediaItem` so it can be rendered by
 * `MediaShelf` / `MediaCard` on the home screen. Mirrors the Rust
 * `MediaRequest::to_media_item()` in `crates/jf-core/src/state.rs`.
 *
 * The item gets a `{ kind: "tmdb" }` id (no Jellyfin id yet — the
 * content may not be in the library), `source: "jellyseerr"`, and
 * `availability` derived from the request status.
 */
export function mediaRequestToMediaItem(request: MediaRequest): MediaItem {
  const availability: Availability =
    request.status === "available"
      ? { kind: "available" }
      : { kind: "requested", status: request.status };
  return {
    id: { kind: "tmdb", tmdbId: request.tmdbId },
    source: "jellyseerr",
    availability,
    mediaType: request.mediaType === "tv" ? "series" : "movie",
    title: request.title,
    sortTitle: request.title,
    year: undefined,
    overview: undefined,
    posterUrl: request.posterUrl,
    backdropUrl: undefined,
    logoUrl: undefined,
    genres: [],
    rating: undefined,
    progress:
      request.downloadProgress && request.downloadProgress.fraction >= 0
        ? request.downloadProgress.fraction
        : undefined,
    runtimeMinutes: undefined,
    userData: undefined,
    seasonCount: undefined,
    episodeCount: undefined,
    seriesName: undefined,
    seasonNumber: undefined,
    episodeNumber: undefined,
    seriesId: undefined,
  };
}

/**
 * Derive the active (non-available) requests sorted for the home shelf:
 * downloading items first, then by insertion order (newest first from API).
 * Mirrors `HomeState::active_request_items()` in `crates/jf-core/src/state.rs`.
 */
export function activeRequestItems(requests: MediaRequest[]): MediaRequest[] {
  const seen = new Set<number>();
  const active = requests.filter((r) => {
    if (r.status === "available") return false;
    if (seen.has(r.tmdbId)) return false;
    seen.add(r.tmdbId);
    return true;
  });
  const downloading = active.filter((r) => r.downloadProgress !== undefined);
  const rest = active.filter((r) => r.downloadProgress === undefined);
  return [...downloading, ...rest];
}

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
// Offline downloads — ported from `crates/jf-core/src/models.rs::DownloadRecord`
// ──────────────────────────────────────────────────────────────────────────────

export type DownloadState = "queued" | "downloading" | "paused" | "done" | "failed";

/**
 * Rich playback metadata captured at enqueue time so the player works
 * fully offline — no server round-trip needed. Mirrors
 * `crates/jf-core/src/models.rs::DownloadMetadata`.
 */
export interface DownloadMetadata {
  durationSeconds: number;
  chapters: Chapter[];
  trickplayInfo: TrickplayInfo | undefined;
  introSkipperSegments: IntroSkipperSegments | undefined;
}

/**
 * One offline download record. The canonical shape shared between the
 * Nitro module (`NativeDownloadRecord`) and the JS services layer.
 * Mirrors `crates/jf-core/src/models.rs::DownloadRecord`.
 */
export interface DownloadRecord {
  /** UUID generated at enqueue time. */
  id: string;
  /** Jellyfin item id. */
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  title: string;
  seriesTitle: string | undefined;
  seasonNumber: number | undefined;
  episodeNumber: number | undefined;
  /** Absolute poster image URL cached at enqueue time. */
  imageUrl: string | undefined;
  /** The original Jellyfin stream URL passed at enqueue time. */
  streamUrl: string;
  /**
   * Path relative to the app's document directory where the media file
   * lives once the download is complete. Rebased on every launch so
   * stale absolute paths (from OS restores / dev rebuilds) still resolve.
   */
  destRelativePath: string;
  bytesDownloaded: number;
  bytesTotal: number;
  state: DownloadState;
  metadata: DownloadMetadata;
  /** Unix milliseconds — used for list ordering. */
  addedAtMs: number;
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
