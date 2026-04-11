// Detail fetchers — movie / series / seasons / episodes. Ports
// `JellyfinClient::get_item_by_id`, `get_seasons`, and
// `get_episodes_by_season` from `crates/jf-api/src/jellyfin.rs` into
// pure functions. Share the PascalCase → MediaItem mapping helpers
// exported by `shelves.ts` so the domain shape stays identical
// everywhere.

import type { MediaItem } from "@jellyfuse/models";
import { isRawJfItem, mapItemsResponse, mapJfItem } from "./shelves";
import type { FetchLike } from "./system-info";

// ──────────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────────

export class DetailHttpError extends Error {
  readonly status: number;
  readonly itemId: string;
  constructor(itemId: string, status: number) {
    super(`Jellyfin detail for '${itemId}' returned HTTP ${status}`);
    this.name = "DetailHttpError";
    this.itemId = itemId;
    this.status = status;
  }
}

export class DetailParseError extends Error {
  readonly itemId: string;
  constructor(itemId: string, message: string) {
    super(`Jellyfin detail for '${itemId}' returned an unexpected payload: ${message}`);
    this.name = "DetailParseError";
    this.itemId = itemId;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetchers
// ──────────────────────────────────────────────────────────────────────────────

export interface DetailFetchArgs {
  baseUrl: string;
  userId: string;
  itemId: string;
}

/**
 * `GET /Users/{uid}/Items/{itemId}` — full metadata for a single movie
 * or series. The same endpoint serves both; the returned `mediaType`
 * discriminates.
 */
export async function fetchItemDetail(
  args: DetailFetchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaItem> {
  const url = `${trimTrailingSlash(args.baseUrl)}/Users/${args.userId}/Items/${args.itemId}`;
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new DetailHttpError(args.itemId, response.status);
  }
  const raw = await response.json();
  if (!isRawJfItem(raw)) {
    throw new DetailParseError(args.itemId, "response is missing Id/Name");
  }
  return mapJfItem(args.baseUrl, raw);
}

export interface SeasonsFetchArgs {
  baseUrl: string;
  userId: string;
  seriesId: string;
}

/** `GET /Shows/{seriesId}/Seasons?UserId=…` — all seasons of a series. */
export async function fetchSeasons(
  args: SeasonsFetchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaItem[]> {
  const url = buildUrl(args.baseUrl, `/Shows/${args.seriesId}/Seasons`, {
    UserId: args.userId,
    Fields: "ImageTags,IndexNumber",
  });
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) throw new DetailHttpError(args.seriesId, response.status);
  const raw = await response.json();
  return mapItemsResponse(args.baseUrl, raw, "seasons");
}

export interface EpisodesFetchArgs {
  baseUrl: string;
  userId: string;
  seriesId: string;
  seasonId: string;
}

/**
 * `GET /Shows/{seriesId}/Episodes?SeasonId=…&UserId=…` — all episodes
 * of a specific season. Returned `MediaItem`s carry `seriesId`,
 * `seasonNumber`, and `episodeNumber` so `EpisodeRow` can render the
 * `"S2 · E4"` label directly.
 */
export async function fetchEpisodes(
  args: EpisodesFetchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaItem[]> {
  const url = buildUrl(args.baseUrl, `/Shows/${args.seriesId}/Episodes`, {
    SeasonId: args.seasonId,
    UserId: args.userId,
    Fields: "Overview,UserData,ImageTags,ParentIndexNumber,IndexNumber,RunTimeTicks",
  });
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) throw new DetailHttpError(args.seasonId, response.status);
  const raw = await response.json();
  return mapItemsResponse(args.baseUrl, raw, "episodes");
}

// ──────────────────────────────────────────────────────────────────────────────
// Local helpers
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
