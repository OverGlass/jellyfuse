// Port of the Jellyfin home-shelf endpoints from
// `crates/jf-api/src/jellyfin.rs`. Pure functions — take a fetcher at
// the call site so the app wires Nitro Fetch + auth headers and tests
// pass a fake fetcher.
//
// Each shelf fetcher hits the real Jellyfin API and normalises the
// PascalCase response into the camelCase `@jellyfuse/models::MediaItem`
// domain type. Mapping mirrors `JellyfinClient::map_item` in Rust so
// downstream views (home, detail, shelf grid) stay consistent across
// the port.

import type {
  Availability,
  MediaId,
  MediaItem,
  MediaSource,
  MediaType,
  UserItemData,
} from "@jellyfuse/models";
import type { FetchLike } from "./system-info";

export type { MediaItem } from "@jellyfuse/models";

/** Common options for a shelf fetch — active user + server base URL. */
export interface ShelfFetchArgs {
  baseUrl: string;
  userId: string;
  /** Max number of items to return. Defaults to 20. */
  limit?: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────────

export class ShelfHttpError extends Error {
  readonly status: number;
  readonly shelf: string;
  constructor(shelf: string, status: number) {
    super(`Jellyfin shelf '${shelf}' returned HTTP ${status}`);
    this.name = "ShelfHttpError";
    this.shelf = shelf;
    this.status = status;
  }
}

export class ShelfParseError extends Error {
  readonly shelf: string;
  constructor(shelf: string, message: string) {
    super(`Jellyfin shelf '${shelf}' returned an unexpected payload: ${message}`);
    this.name = "ShelfParseError";
    this.shelf = shelf;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Shelf fetchers
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_FIELDS =
  "Overview,Genres,RunTimeTicks,UserData,ImageTags,BackdropImageTags,ProviderIds";

const NEXT_UP_FIELDS =
  "Overview,UserData,ImageTags,BackdropImageTags,SeriesName,SeriesId,ParentIndexNumber,IndexNumber,ProviderIds";

const RESUME_FIELDS =
  "Overview,Genres,RunTimeTicks,UserData,ImageTags,BackdropImageTags,SeriesName,ParentIndexNumber,IndexNumber,ProviderIds";

/** `GET /Users/{uid}/Items/Resume` — items in progress (Continue Watching). */
export async function fetchContinueWatching(
  args: ShelfFetchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaItem[]> {
  const url = buildUrl(args.baseUrl, `/Users/${args.userId}/Items/Resume`, {
    MediaTypes: "Video",
    Limit: String(args.limit ?? 20),
    Recursive: "true",
    Fields: RESUME_FIELDS,
  });
  return fetchShelf("continue-watching", url, args.baseUrl, fetcher, signal, mapItemsResponse);
}

/** `GET /Shows/NextUp?UserId=…` — next unwatched episode per series. */
export async function fetchNextUp(
  args: ShelfFetchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaItem[]> {
  const url = buildUrl(args.baseUrl, `/Shows/NextUp`, {
    UserId: args.userId,
    Limit: String(args.limit ?? 20),
    Fields: NEXT_UP_FIELDS,
  });
  const items = await fetchShelf("next-up", url, args.baseUrl, fetcher, signal, mapItemsResponse);
  // Use the series poster / backdrop for portrait card display (mirrors
  // `get_next_up_items` in Rust) so episode tiles pick up the show art
  // instead of the episode thumbnail.
  return items.map((item) => {
    if (!item.seriesId) return item;
    return {
      ...item,
      posterUrl: buildPrimaryImageUrl(args.baseUrl, item.seriesId, 400),
      backdropUrl: buildBackdropImageUrl(args.baseUrl, item.seriesId, 1280),
    };
  });
}

/** `GET /Users/{uid}/Items/Latest` — recently added. */
export async function fetchRecentlyAdded(
  args: ShelfFetchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaItem[]> {
  const url = buildUrl(args.baseUrl, `/Users/${args.userId}/Items/Latest`, {
    Limit: String(args.limit ?? 20),
    Fields: DEFAULT_FIELDS,
  });
  // /Items/Latest returns a bare array, not { Items, TotalRecordCount }.
  return fetchShelf("recently-added", url, args.baseUrl, fetcher, signal, mapBareArray);
}

/** `GET /Users/{uid}/Items?IncludeItemTypes=Movie&SortBy=DateCreated` — latest movies. */
export async function fetchLatestMovies(
  args: ShelfFetchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaItem[]> {
  const url = buildUrl(args.baseUrl, `/Users/${args.userId}/Items`, {
    IncludeItemTypes: "Movie",
    SortBy: "DateCreated",
    SortOrder: "Descending",
    Recursive: "true",
    Limit: String(args.limit ?? 20),
    Fields: DEFAULT_FIELDS,
  });
  return fetchShelf("latest-movies", url, args.baseUrl, fetcher, signal, mapItemsResponse);
}

/** `GET /Users/{uid}/Items?IncludeItemTypes=Series&SortBy=DateCreated` — latest TV. */
export async function fetchLatestTv(
  args: ShelfFetchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaItem[]> {
  const url = buildUrl(args.baseUrl, `/Users/${args.userId}/Items`, {
    IncludeItemTypes: "Series",
    SortBy: "DateCreated",
    SortOrder: "Descending",
    Recursive: "true",
    Limit: String(args.limit ?? 20),
    Fields: DEFAULT_FIELDS,
  });
  return fetchShelf("latest-tv", url, args.baseUrl, fetcher, signal, mapItemsResponse);
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared fetch plumbing
// ──────────────────────────────────────────────────────────────────────────────

type RawMapper = (baseUrl: string, raw: unknown, shelf: string) => MediaItem[];

async function fetchShelf(
  shelf: string,
  url: string,
  baseUrl: string,
  fetcher: FetchLike,
  signal: AbortSignal | undefined,
  mapper: RawMapper,
): Promise<MediaItem[]> {
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new ShelfHttpError(shelf, response.status);
  }
  const raw = await response.json();
  return mapper(baseUrl, raw, shelf);
}

function mapItemsResponse(baseUrl: string, raw: unknown, shelf: string): MediaItem[] {
  if (typeof raw !== "object" || raw === null) {
    throw new ShelfParseError(shelf, "response is not an object");
  }
  const r = raw as { Items?: unknown };
  if (!Array.isArray(r.Items)) {
    throw new ShelfParseError(shelf, "missing 'Items' array");
  }
  return r.Items.map((raw, i) => {
    if (!isRawJfItem(raw)) {
      throw new ShelfParseError(shelf, `item at index ${i} has unexpected shape`);
    }
    return mapJfItem(baseUrl, raw);
  });
}

function mapBareArray(baseUrl: string, raw: unknown, shelf: string): MediaItem[] {
  if (!Array.isArray(raw)) {
    throw new ShelfParseError(shelf, "expected a bare array response");
  }
  return raw.map((item, i) => {
    if (!isRawJfItem(item)) {
      throw new ShelfParseError(shelf, `item at index ${i} has unexpected shape`);
    }
    return mapJfItem(baseUrl, item);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Raw Jellyfin DTO → MediaItem mapping (mirrors `JellyfinClient::map_item`)
// ──────────────────────────────────────────────────────────────────────────────

interface RawJfItem {
  Id: string;
  Name: string;
  SortName?: string;
  Type?: string;
  ProductionYear?: number;
  Overview?: string;
  CommunityRating?: number;
  RunTimeTicks?: number;
  Genres?: string[];
  SeriesCount?: number;
  ChildCount?: number;
  // Episode-specific
  SeriesName?: string;
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  UserData?: RawJfUserData;
  ImageTags?: RawJfImageTags;
  BackdropImageTags?: string[];
  ProviderIds?: RawJfProviderIds;
}

interface RawJfUserData {
  Played?: boolean;
  PlayCount?: number;
  PlaybackPositionTicks?: number;
  IsFavorite?: boolean;
  LastPlayedDate?: string;
  PlayedPercentage?: number;
}

interface RawJfImageTags {
  Primary?: string;
  Thumb?: string;
  Logo?: string;
}

interface RawJfProviderIds {
  Tmdb?: string;
  Imdb?: string;
  Tvdb?: string;
}

function isRawJfItem(value: unknown): value is RawJfItem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["Id"] === "string" && typeof v["Name"] === "string";
}

function mapJfItem(baseUrl: string, item: RawJfItem): MediaItem {
  const mediaType = mapMediaType(item.Type);
  const posterUrl = item.ImageTags?.Primary
    ? buildPrimaryImageUrl(baseUrl, item.Id, 400)
    : undefined;
  const backdropUrl = (() => {
    if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
      return buildBackdropImageUrl(baseUrl, item.Id, 1280);
    }
    if (item.ImageTags?.Thumb) {
      return `${trimTrailingSlash(baseUrl)}/Items/${item.Id}/Images/Thumb?maxWidth=1280&quality=90`;
    }
    return undefined;
  })();
  const logoUrl = item.ImageTags?.Logo
    ? `${trimTrailingSlash(baseUrl)}/Items/${item.Id}/Images/Logo`
    : undefined;

  const progress =
    item.UserData?.PlayedPercentage !== undefined
      ? clamp01(item.UserData.PlayedPercentage / 100)
      : undefined;

  const userData: UserItemData | undefined = item.UserData
    ? {
        played: item.UserData.Played ?? false,
        playCount: item.UserData.PlayCount ?? 0,
        playbackPositionTicks: item.UserData.PlaybackPositionTicks ?? 0,
        isFavorite: item.UserData.IsFavorite ?? false,
        lastPlayedDate: item.UserData.LastPlayedDate,
      }
    : undefined;

  const runtimeMinutes =
    item.RunTimeTicks !== undefined ? Math.floor(item.RunTimeTicks / 10_000_000 / 60) : undefined;

  const tmdbIdRaw = item.ProviderIds?.Tmdb;
  const tmdbId = tmdbIdRaw ? Number.parseInt(tmdbIdRaw, 10) : Number.NaN;
  const id: MediaId = Number.isFinite(tmdbId)
    ? { kind: "both", jellyfinId: item.Id, tmdbId }
    : { kind: "jellyfin", jellyfinId: item.Id };

  const source: MediaSource = "jellyfin";
  const availability: Availability = { kind: "available" };

  return {
    id,
    source,
    availability,
    mediaType,
    title: item.Name,
    sortTitle: item.SortName,
    year: item.ProductionYear,
    overview: item.Overview,
    posterUrl,
    backdropUrl,
    logoUrl,
    genres: item.Genres ?? [],
    rating: item.CommunityRating,
    progress,
    runtimeMinutes,
    userData,
    seasonCount: item.SeriesCount,
    episodeCount: item.ChildCount,
    seriesName: item.SeriesName,
    seasonNumber: item.ParentIndexNumber,
    episodeNumber: item.IndexNumber,
    seriesId: item.SeriesId,
  };
}

function mapMediaType(rawType: string | undefined): MediaType {
  switch (rawType) {
    case "Movie":
      return "movie";
    case "Series":
      return "series";
    case "Episode":
      return "episode";
    case "Season":
      return "season";
    case "Audio":
    case "MusicAlbum":
      return "music";
    case "BoxSet":
      return "collection";
    default:
      return "movie";
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Image URL builders (ports of `poster_url` / `backdrop_url`)
// ──────────────────────────────────────────────────────────────────────────────

export function buildPrimaryImageUrl(baseUrl: string, itemId: string, maxWidth: number): string {
  return `${trimTrailingSlash(baseUrl)}/Items/${itemId}/Images/Primary?maxWidth=${maxWidth}&quality=90`;
}

export function buildBackdropImageUrl(baseUrl: string, itemId: string, maxWidth: number): string {
  return `${trimTrailingSlash(baseUrl)}/Items/${itemId}/Images/Backdrop?maxWidth=${maxWidth}&quality=90`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildUrl(baseUrl: string, path: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${trimTrailingSlash(baseUrl)}${path}${qs ? `?${qs}` : ""}`;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
