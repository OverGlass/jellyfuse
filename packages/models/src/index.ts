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
