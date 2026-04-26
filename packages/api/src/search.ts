// Blended search: Jellyfin library + Jellyseerr (TMDB) with dedupe.
// Ports `crates/jf-search/src/lib.rs::SearchEngine::search` — two
// parallel fetches, then filter Jellyseerr results that already exist
// in the library by TMDB id, falling back to a normalised title match
// when the TMDB id is missing. Pure functions only: the hook in
// `apps/mobile` fans out the HTTP side via `useQueries` and calls
// `blendSearchResults` on the combined result.

import type {
  Availability,
  BlendedSearchResults,
  MediaId,
  MediaItem,
  MediaType,
} from "@jellyfuse/models";
import { mediaIdTmdb } from "@jellyfuse/models";
import { mapItemsResponse } from "./shelves";
import type { FetchLike } from "./system-info";

// ── Errors ──────────────────────────────────────────────────────────

export class SearchHttpError extends Error {
  readonly source: "jellyfin" | "jellyseerr";
  readonly status: number;
  constructor(source: "jellyfin" | "jellyseerr", status: number) {
    super(`${source} search returned HTTP ${status}`);
    this.name = "SearchHttpError";
    this.source = source;
    this.status = status;
  }
}

export class SearchParseError extends Error {
  readonly source: "jellyfin" | "jellyseerr";
  constructor(source: "jellyfin" | "jellyseerr", message: string) {
    super(`${source} search returned an unexpected payload: ${message}`);
    this.name = "SearchParseError";
    this.source = source;
  }
}

// ── Jellyfin search ─────────────────────────────────────────────────

const JELLYFIN_SEARCH_FIELDS =
  "Overview,Genres,RunTimeTicks,UserData,ImageTags,BackdropImageTags,ProviderIds";

/** Item types the Jellyfin search can be restricted to. */
export type JellyfinSearchItemType = "Movie" | "Series" | "Movie,Series";

export interface JellyfinSearchArgs {
  baseUrl: string;
  userId: string;
  query: string;
  /** Max number of items to return. Defaults to 25. */
  limit?: number;
  /** Item types to include — defaults to `"Movie,Series"`. */
  includeTypes?: JellyfinSearchItemType;
}

/**
 * `GET /Users/{uid}/Items?SearchTerm=…` — searches the library for
 * movies and series matching the query string. Empty query short-
 * circuits to `[]` without hitting the server.
 */
export async function fetchJellyfinSearch(
  args: JellyfinSearchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaItem[]> {
  const query = args.query.trim();
  if (!query) return [];
  const url = buildUrl(args.baseUrl, `/Users/${args.userId}/Items`, {
    SearchTerm: query,
    IncludeItemTypes: args.includeTypes ?? "Movie,Series",
    Recursive: "true",
    Limit: String(args.limit ?? 25),
    Fields: JELLYFIN_SEARCH_FIELDS,
  });
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new SearchHttpError("jellyfin", response.status);
  }
  const raw = await response.json();
  try {
    return mapItemsResponse(args.baseUrl, raw, "search");
  } catch (err) {
    throw new SearchParseError("jellyfin", err instanceof Error ? err.message : String(err));
  }
}

// ── Jellyseerr search ───────────────────────────────────────────────

export interface JellyseerrSearchArgs {
  baseUrl: string;
  query: string;
  /** 1-indexed page number. Defaults to 1. */
  page?: number;
}

/**
 * `GET /api/v1/search?query=…` — Jellyseerr's multi-search endpoint.
 * Returns movies and TV results (persons are filtered out). Empty
 * query short-circuits to `[]`. Assumes the `connect.sid` cookie is
 * attached by the underlying HTTP stack (URLSession cookie jar in
 * the app; injected manually by the test fake fetcher).
 */
export async function fetchJellyseerrSearch(
  args: JellyseerrSearchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaItem[]> {
  const query = args.query.trim();
  if (!query) return [];
  const url = buildUrl(args.baseUrl, `/api/v1/search`, {
    query,
    page: String(args.page ?? 1),
  });
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new SearchHttpError("jellyseerr", response.status);
  }
  const raw = await response.json();
  return mapJellyseerrSearchResponse(raw);
}

// ── Blend / dedupe ──────────────────────────────────────────────────

/** Optional media-type filter used when blending shelf-grid searches. */
export type BlendedSearchTypeFilter = "movie" | "series";

/**
 * Port of `SearchEngine::search` from `crates/jf-search/src/lib.rs`.
 * Given the two raw result arrays, returns the split into library vs
 * requestable items. A Jellyseerr result is dropped when:
 *
 * 1. Its TMDB id matches any library item's TMDB id, or
 * 2. Its normalised title (lowercased, whitespace-collapsed) matches
 *    any library item's title — fallback when the TMDB id is absent
 *    on either side.
 *
 * The library array is passed through unchanged (already deduped by
 * Jellyfin). Ordering inside each output array is preserved. Pass an
 * optional `typeFilter` to constrain both sides to one media type
 * (used by the typed shelf-grid search variants — Latest Movies and
 * Latest TV in Rust).
 */
export function blendSearchResults(
  libraryItems: MediaItem[],
  jellyseerrItems: MediaItem[],
  typeFilter?: BlendedSearchTypeFilter,
): BlendedSearchResults {
  if (typeFilter !== undefined) {
    libraryItems = libraryItems.filter((item) => item.mediaType === typeFilter);
    jellyseerrItems = jellyseerrItems.filter((item) => item.mediaType === typeFilter);
  }
  const libraryTmdbIds = new Set<number>();
  const libraryTitles = new Set<string>();
  for (const item of libraryItems) {
    const tmdb = mediaIdTmdb(item.id);
    if (tmdb !== undefined) libraryTmdbIds.add(tmdb);
    libraryTitles.add(normalizeTitle(item.title));
  }
  const requestableItems: MediaItem[] = [];
  for (const item of jellyseerrItems) {
    const tmdb = mediaIdTmdb(item.id);
    if (tmdb !== undefined && libraryTmdbIds.has(tmdb)) continue;
    if (libraryTitles.has(normalizeTitle(item.title))) continue;
    requestableItems.push(item);
  }
  return { libraryItems, requestableItems };
}

/** Lowercase, trim, collapse whitespace. Matches Rust `normalize_title`. */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

// ── Jellyseerr mapping ──────────────────────────────────────────────

interface RawJellyseerrResult {
  id: number;
  mediaType: string;
  title?: string;
  name?: string;
  releaseDate?: string;
  firstAirDate?: string;
  overview?: string;
  posterPath?: string | null;
  backdropPath?: string | null;
  voteAverage?: number;
  mediaInfo?: { status?: number };
}

function mapJellyseerrSearchResponse(raw: unknown): MediaItem[] {
  if (typeof raw !== "object" || raw === null) {
    throw new SearchParseError("jellyseerr", "response is not an object");
  }
  const r = raw as { results?: unknown };
  if (!Array.isArray(r.results)) {
    throw new SearchParseError("jellyseerr", "missing 'results' array");
  }
  const items: MediaItem[] = [];
  for (const entry of r.results) {
    const item = mapJellyseerrSearchItem(entry);
    if (item) items.push(item);
  }
  return items;
}

function mapJellyseerrSearchItem(entry: unknown): MediaItem | undefined {
  if (typeof entry !== "object" || entry === null) return undefined;
  const raw = entry as RawJellyseerrResult;
  if (raw.mediaType !== "movie" && raw.mediaType !== "tv") return undefined;
  if (typeof raw.id !== "number") return undefined;
  const title = raw.title ?? raw.name;
  if (!title) return undefined;

  const mediaType: MediaType = raw.mediaType === "movie" ? "movie" : "series";
  const id: MediaId = { kind: "tmdb", tmdbId: raw.id };
  const year = parseYear(raw.releaseDate ?? raw.firstAirDate);
  const posterUrl = raw.posterPath ? `https://image.tmdb.org/t/p/w500${raw.posterPath}` : undefined;
  const backdropUrl = raw.backdropPath
    ? `https://image.tmdb.org/t/p/w1280${raw.backdropPath}`
    : undefined;

  return {
    id,
    source: "jellyseerr",
    availability: mapJellyseerrAvailability(raw.mediaInfo?.status),
    mediaType,
    title,
    sortTitle: undefined,
    year,
    overview: raw.overview,
    posterUrl,
    backdropUrl,
    logoUrl: undefined,
    genres: [],
    rating: raw.voteAverage,
    progress: undefined,
    runtimeMinutes: undefined,
    userData: undefined,
    seasonCount: undefined,
    episodeCount: undefined,
    seriesName: undefined,
    seasonNumber: undefined,
    episodeNumber: undefined,
    seriesId: undefined,
    seasonId: undefined,
  };
}

// Jellyseerr media status codes (see `server/constants/media.ts`):
//   1 = unknown, 2 = pending, 3 = processing, 4 = partially available, 5 = available
function mapJellyseerrAvailability(status: number | undefined): Availability {
  switch (status) {
    case 5:
      return { kind: "available" };
    case 4:
      return { kind: "requested", status: "approved" };
    case 3:
      return { kind: "requested", status: "approved" };
    case 2:
      return { kind: "requested", status: "pending" };
    default:
      return { kind: "missing" };
  }
}

function parseYear(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : undefined;
}

// ── Local URL builder (sibling of the one in shelves.ts) ────────────

function buildUrl(baseUrl: string, path: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${trimTrailingSlash(baseUrl)}${path}${qs ? `?${qs}` : ""}`;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
