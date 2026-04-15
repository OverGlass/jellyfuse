import type {
  DownloadProgress,
  MediaRequest,
  MediaRequestStatus,
  MediaServer,
  QualityProfile,
  SeasonAvailability,
  SeasonInfo,
} from "@jellyfuse/models";
import type { FetchLike } from "./system-info";

/**
 * Jellyseerr login flow. Ports `JellyseerrClient::login` from
 * `crates/jf-api/src/jellyseerr.rs:60-95`. Unlike Jellyfin the login
 * endpoint lives under `/api/v1/auth/jellyfin` — Jellyseerr validates
 * the Jellyfin credentials against the linked Jellyfin server and
 * returns a server-side session identified by a `connect.sid` cookie
 * in the `Set-Cookie` response header.
 *
 * Jellyseerr is **optional** per the Rust spec (see memory:
 * project_jellyfuse_auth_architecture) — callers always catch errors
 * from this function and fall back to "not configured" state so the
 * rest of the app keeps working.
 */

export interface JellyseerrSession {
  /**
   * The raw value of the `connect.sid` cookie, e.g. `s%3A...` — or
   * `null` if the HTTP call succeeded but the `Set-Cookie` header
   * wasn't visible to our fetcher. React Native's Fetch API (including
   * Nitro Fetch) mirrors the browser "forbidden response header" rule
   * and hides Set-Cookie from JavaScript, so in the app we always see
   * `null` here and fall back to reading from the native cookie jar
   * via `react-native-nitro-cookies`. Vitest / node-fetch-based tests
   * see the actual string.
   */
  cookie: string | null;
}

export class JellyseerrHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Jellyseerr /api/v1/auth/jellyfin returned HTTP ${status}`);
    this.name = "JellyseerrHttpError";
    this.status = status;
  }
}

export interface JellyseerrLoginInput {
  /** Jellyseerr base URL, e.g. `https://jellyseerr.example.com` */
  baseUrl: string;
  /** Jellyfin username (Jellyseerr uses Jellyfin as its auth provider). */
  username: string;
  /** Jellyfin password — same credentials as the Jellyfin sign-in. */
  password: string;
}

/**
 * Response shape used by `jellyseerrLogin`. Wider than the shared
 * `FetchLike` result because the endpoint needs `headers.get("set-cookie")`
 * to pull the session cookie out of the response.
 */
interface ResponseWithHeaders {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  headers: { get: (name: string) => string | null };
}

/**
 * POST `/api/v1/auth/jellyfin`. On success the returned
 * `JellyseerrSession.cookie` is the `connect.sid` value — callers
 * persist it and inject it as a `Cookie` header on every subsequent
 * Jellyseerr request (see `services/jellyseerr/client.ts`).
 */
export async function jellyseerrLogin(
  input: JellyseerrLoginInput,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<JellyseerrSession> {
  const url = joinPath(input.baseUrl, "/api/v1/auth/jellyfin");
  const body = JSON.stringify({ username: input.username, password: input.password });

  // Widen the fetcher locally so we can set method/headers/body and
  // read the `Set-Cookie` response header — the shared `FetchLike`
  // only declares `signal` in its init and doesn't expose `headers`
  // on the response. Nitro Fetch + global fetch both have both at
  // runtime, so the cast through `unknown` is safe.
  const wideFetcher = fetcher as unknown as (
    input: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body: string;
      signal: AbortSignal | undefined;
    },
  ) => Promise<ResponseWithHeaders>;

  const response = await wideFetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });

  if (!response.ok) {
    throw new JellyseerrHttpError(response.status);
  }

  const setCookie = response.headers.get("set-cookie");
  const cookie = extractConnectSid(setCookie);
  // In React Native / Nitro Fetch the Set-Cookie header is hidden from
  // JavaScript — we fall through with `cookie: null` and the caller is
  // expected to read the cookie from the native jar via
  // react-native-nitro-cookies. In Vitest / node-fetch with a fake
  // fetcher that exposes Set-Cookie the caller gets the real string.
  return { cookie: cookie ?? null };
}

function joinPath(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

// ──────────────────────────────────────────────────────────────────────
// Request flow — quality profiles, TV seasons, create request
// ──────────────────────────────────────────────────────────────────────

export class JellyseerrRequestError extends Error {
  readonly status: number;
  readonly endpoint: string;
  constructor(endpoint: string, status: number) {
    super(`Jellyseerr ${endpoint} returned HTTP ${status}`);
    this.name = "JellyseerrRequestError";
    this.endpoint = endpoint;
    this.status = status;
  }
}

export type JellyseerrServiceType = "radarr" | "sonarr";

interface RawArrServerEntry {
  id?: number;
  name?: string;
  activeProfileId?: number | null;
  activeProfileName?: string | null;
}

interface RawServiceProfile {
  id?: number;
  name?: string;
}

interface RawServiceResponse {
  server?: { activeProfileId?: number | null } | null;
  profiles?: RawServiceProfile[];
}

/**
 * Fetch the quality profiles available on every configured Radarr or
 * Sonarr server in Jellyseerr. Mirrors `JellyseerrClient::get_arr_servers`
 * in `crates/jf-api/src/jellyseerr.rs`:
 *
 * 1. Try `GET /api/v1/{type}` to list servers (admin-only). If that
 *    fails the caller is non-admin — fall back to a single virtual
 *    server with id `0` so the per-server `service` lookup still works.
 * 2. For each server id, `GET /api/v1/service/{type}/{serverId}` to
 *    pull the profiles + the active default profile.
 * 3. Map the raw shape into our `MediaServer[]`.
 *
 * Returns an empty array when Jellyseerr has no servers configured at
 * all — callers should treat that as "Jellyseerr can't fulfil
 * requests for this media type" and surface a friendly error.
 */
export async function fetchQualityProfiles(
  args: { baseUrl: string; service: JellyseerrServiceType },
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaServer[]> {
  const serversListUrl = joinPath(args.baseUrl, `/api/v1/${args.service}`);
  let servers: RawArrServerEntry[] = [];
  try {
    const listResponse = await fetcher(serversListUrl, signal ? { signal } : undefined);
    if (listResponse.ok) {
      const listJson = await listResponse.json();
      if (Array.isArray(listJson)) servers = listJson as RawArrServerEntry[];
    }
  } catch {
    // Non-admin users get 403 here — fall through to the default
    // server lookup below. We never throw on the list endpoint.
  }

  const serverIds: { id: number; name: string }[] =
    servers.length > 0
      ? servers
          .filter((s): s is RawArrServerEntry & { id: number } => typeof s.id === "number")
          .map((s) => ({ id: s.id, name: typeof s.name === "string" ? s.name : args.service }))
      : [{ id: 0, name: args.service }];

  const result: MediaServer[] = [];
  for (const { id, name } of serverIds) {
    const serviceUrl = joinPath(args.baseUrl, `/api/v1/service/${args.service}/${id}`);
    let raw: RawServiceResponse | null = null;
    try {
      const response = await fetcher(serviceUrl, signal ? { signal } : undefined);
      if (response.ok) {
        const json = await response.json();
        if (typeof json === "object" && json !== null) raw = json as RawServiceResponse;
      }
    } catch {
      // ignore per-server errors — try the next id
    }

    const defaultProfileId = raw?.server?.activeProfileId ?? undefined;
    const profiles: QualityProfile[] = (raw?.profiles ?? [])
      .filter(
        (p): p is RawServiceProfile & { id: number; name: string } =>
          typeof p.id === "number" && typeof p.name === "string",
      )
      .map((p) => ({ id: p.id, name: p.name }));

    // Fallback: if the per-server `service` call returned no profiles
    // but the list call surfaced an active profile name, use that as
    // a single-entry profile list. Mirrors the Rust fallback.
    let finalProfiles: QualityProfile[] = profiles;
    if (finalProfiles.length === 0 && servers.length > 0) {
      const matching = servers.find((s) => s.id === id);
      if (
        matching?.activeProfileId !== undefined &&
        matching.activeProfileId !== null &&
        typeof matching.activeProfileName === "string"
      ) {
        finalProfiles = [{ id: matching.activeProfileId, name: matching.activeProfileName }];
      }
    }

    result.push({
      id,
      name,
      profiles: finalProfiles,
      defaultProfileId: defaultProfileId === null ? undefined : defaultProfileId,
    });
  }

  return result;
}

interface RawTmdbSeason {
  seasonNumber?: number;
  name?: string;
}

interface RawMediaInfoSeason {
  seasonNumber?: number;
  status?: number;
}

interface RawMediaInfoRequest {
  status?: number;
  seasons?: { seasonNumber?: number }[];
}

interface RawTmdbTvDetail {
  seasons?: RawTmdbSeason[];
  mediaInfo?: {
    seasons?: RawMediaInfoSeason[];
    requests?: RawMediaInfoRequest[];
  };
}

/**
 * `GET /api/v1/tv/{tmdbId}` — TMDB show detail with the Jellyseerr
 * `mediaInfo` envelope merged in. Returns the per-season availability
 * info needed by the request modal (mirrors Rust `get_tv_seasons`).
 *
 * Status priority for each season:
 *   1. `mediaInfo.seasons[].status === 5` → `available`
 *   2. `mediaInfo.seasons[].status` 2/3/4 OR `mediaInfo.requests[].seasons`
 *      with status 1 (pending) or 2 (approved) → `requested`
 *   3. otherwise → `missing`
 *
 * Specials (season 0) are dropped — Jellyseerr never lets them be
 * requested via the standard flow.
 */
export async function fetchTmdbTvSeasons(
  args: { baseUrl: string; tmdbId: number },
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<SeasonInfo[]> {
  const url = joinPath(args.baseUrl, `/api/v1/tv/${args.tmdbId}`);
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new JellyseerrRequestError(`/api/v1/tv/${args.tmdbId}`, response.status);
  }
  const raw = (await response.json()) as RawTmdbTvDetail;

  const tmdbSeasons = Array.isArray(raw.seasons) ? raw.seasons : [];
  const mediaSeasons = Array.isArray(raw.mediaInfo?.seasons) ? (raw.mediaInfo?.seasons ?? []) : [];
  const requests = Array.isArray(raw.mediaInfo?.requests) ? (raw.mediaInfo?.requests ?? []) : [];

  const statusBySeason = new Map<number, number>();
  for (const ms of mediaSeasons) {
    if (typeof ms.seasonNumber === "number" && typeof ms.status === "number") {
      statusBySeason.set(ms.seasonNumber, ms.status);
    }
  }

  const requestedSeasons = new Set<number>();
  for (const req of requests) {
    const requestStatus = req.status ?? 0;
    // 1 = pending, 2 = approved
    if (requestStatus !== 1 && requestStatus !== 2) continue;
    for (const s of req.seasons ?? []) {
      if (typeof s.seasonNumber === "number" && s.seasonNumber > 0) {
        requestedSeasons.add(s.seasonNumber);
      }
    }
  }

  const result: SeasonInfo[] = [];
  for (const s of tmdbSeasons) {
    const seasonNumber = s.seasonNumber ?? 0;
    if (seasonNumber <= 0) continue; // skip specials
    const name =
      typeof s.name === "string" && s.name.length > 0 ? s.name : `Season ${seasonNumber}`;
    const seasonStatus = statusBySeason.get(seasonNumber);
    let availability: SeasonAvailability;
    if (seasonStatus === 5) {
      availability = "available";
    } else if (seasonStatus === 2 || seasonStatus === 3 || seasonStatus === 4) {
      availability = "requested";
    } else if (requestedSeasons.has(seasonNumber)) {
      availability = "requested";
    } else {
      availability = "missing";
    }
    result.push({ seasonNumber, name, availability });
  }
  return result;
}

export interface CreateRequestArgs {
  baseUrl: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  /** TV only — list of season numbers. Omit / `undefined` = all seasons. */
  seasons?: number[];
  /** Optional — Jellyseerr picks the default server when omitted. */
  serverId?: number;
  /** Optional — Jellyseerr picks the default profile when omitted. */
  profileId?: number;
}

/**
 * `POST /api/v1/request` — submit a new media request to Jellyseerr.
 * Mirrors `JellyseerrClient::create_request` in the Rust client.
 * Throws `JellyseerrRequestError` on any non-2xx; success returns
 * void (we don't parse the response — the caller invalidates the
 * requests list query and re-fetches if it needs the new entry).
 */
export async function createJellyseerrRequest(
  args: CreateRequestArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<void> {
  const url = joinPath(args.baseUrl, "/api/v1/request");
  const body: Record<string, unknown> = {
    mediaId: args.tmdbId,
    mediaType: args.mediaType,
  };
  if (args.seasons !== undefined) body["seasons"] = args.seasons;
  if (args.serverId !== undefined) body["serverId"] = args.serverId;
  if (args.profileId !== undefined) body["profileId"] = args.profileId;

  const wideFetcher = fetcher as unknown as (
    input: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body: string;
      signal: AbortSignal | undefined;
    },
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

  const response = await wideFetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new JellyseerrRequestError("/api/v1/request", response.status);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Requests list + download progress
// ──────────────────────────────────────────────────────────────────────

interface RawRequestMedia {
  tmdbId?: number;
  mediaType?: string;
  title?: string;
  name?: string;
  posterPath?: string | null;
  downloadStatus?: RawDownloadStatusEntry[];
  downloadStatus4k?: RawDownloadStatusEntry[];
}

interface RawDownloadStatusEntry {
  size?: number;
  sizeLeft?: number;
  status?: string;
  timeLeft?: string;
}

interface RawRequestedBy {
  displayName?: string;
  username?: string;
}

interface RawRequest {
  id?: number;
  status?: number;
  type?: string;
  media?: RawRequestMedia;
  requestedBy?: RawRequestedBy;
  createdAt?: string;
  seasons?: { seasonNumber?: number }[];
}

interface RawRequestsResponse {
  results?: RawRequest[];
  pageInfo?: {
    pages?: number;
    pageSize?: number;
    results?: number;
    page?: number;
  };
}

/**
 * `GET /api/v1/request?take=…&skip=…&sort=added` — list media
 * requests the current Jellyseerr user is allowed to see. The Rust
 * client pulls a single page of 100 (the hardcoded upper limit in
 * `fetchers::get_requests`) and we match that default. Pagination is
 * available via `take` + `skip` if callers need it later.
 *
 * `downloadProgress` is *not* populated here — it comes from the
 * per-item media detail endpoint and is merged in client-side
 * (see `fetchDownloadProgress` + the React Query hook).
 */
export async function fetchJellyseerrRequests(
  args: { baseUrl: string; take?: number; skip?: number },
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<MediaRequest[]> {
  const take = args.take ?? 100;
  const skip = args.skip ?? 0;
  const url = joinPath(args.baseUrl, `/api/v1/request?take=${take}&skip=${skip}&sort=added`);
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new JellyseerrRequestError("/api/v1/request", response.status);
  }
  const raw = (await response.json()) as RawRequestsResponse;
  const results = Array.isArray(raw.results) ? raw.results : [];

  // Map the basic list — title and poster may be absent from the request's
  // inline media object (Jellyseerr stores media without denormalized title).
  const mapped: MediaRequest[] = [];
  for (const r of results) {
    const req = mapRequestRecord(r);
    if (req) mapped.push(req);
  }

  // Enrich with real title + poster from the media detail endpoint — mirrors
  // Rust's `get_item_by_tmdb` fan-out in `jellyseerr.rs::get_requests()`.
  // Fire all enrichment calls in parallel; fall back to whatever the basic
  // record had if the call fails.
  const enriched = await Promise.all(
    mapped.map(async (req) => {
      if (req.title && req.posterUrl) return req; // already complete, skip round-trip
      try {
        const path = req.mediaType === "tv" ? "tv" : "movie";
        const detailUrl = joinPath(args.baseUrl, `/api/v1/${path}/${req.tmdbId}`);
        const detailResp = await fetcher(detailUrl, signal ? { signal } : undefined);
        if (!detailResp.ok) return req;
        const detail = (await detailResp.json()) as {
          title?: string;
          name?: string;
          posterPath?: string | null;
        };
        const enrichedTitle = detail.title ?? detail.name ?? req.title;
        const enrichedPoster = detail.posterPath
          ? `https://image.tmdb.org/t/p/w342${detail.posterPath}`
          : req.posterUrl;
        return { ...req, title: enrichedTitle, posterUrl: enrichedPoster };
      } catch {
        return req;
      }
    }),
  );

  return enriched.filter((r) => r.title !== "");
}

function mapRequestRecord(raw: RawRequest): MediaRequest | undefined {
  if (typeof raw.id !== "number") return undefined;
  const type = raw.type === "tv" ? "tv" : raw.type === "movie" ? "movie" : undefined;
  if (!type) return undefined;
  const media = raw.media ?? {};
  if (typeof media.tmdbId !== "number") return undefined;
  // Title may be absent on the inline media object — enrichment fills it in.
  const title = media.title ?? media.name ?? "";
  const posterUrl = media.posterPath
    ? `https://image.tmdb.org/t/p/w342${media.posterPath}`
    : undefined;
  const requestedBy = raw.requestedBy?.displayName ?? raw.requestedBy?.username ?? "Unknown";
  const seasons = Array.isArray(raw.seasons)
    ? raw.seasons.map((s) => s.seasonNumber).filter((n): n is number => typeof n === "number")
    : [];

  return {
    id: raw.id,
    status: mapRequestStatusCode(raw.status),
    mediaType: type,
    tmdbId: media.tmdbId,
    title,
    posterUrl,
    requestedBy,
    createdAt: raw.createdAt,
    seasons,
    downloadProgress: undefined,
  };
}

// Jellyseerr numeric status codes (see `server/constants/media.ts`
// in the Jellyseerr repo): 2 = pending, 3 = approved, 5 = available,
// everything else (1 = unknown, 4 = declined, …) → declined.
function mapRequestStatusCode(status: number | undefined): MediaRequestStatus {
  switch (status) {
    case 2:
      return "pending";
    case 3:
      return "approved";
    case 5:
      return "available";
    default:
      return "declined";
  }
}

interface RawMediaDetailWithInfo {
  mediaInfo?: {
    downloadStatus?: RawDownloadStatusEntry[];
  };
}

/**
 * `GET /api/v1/{movie|tv}/{tmdbId}` — fetches the Jellyseerr media
 * detail and extracts the aggregated download progress from
 * `mediaInfo.downloadStatus`. Returns `undefined` when Jellyseerr
 * has nothing in the queue for this TMDB id (the download hasn't
 * started, or the media is already fully available).
 *
 * Progress calculation mirrors `crates/jf-api/src/jellyseerr.rs::fetch_download_progress`:
 *
 * - If `downloadStatus` is missing or empty → `undefined`.
 * - If all entries report `size === 0` → `fraction: -1` (queued,
 *   no bytes yet — UI renders an indeterminate indicator).
 * - Otherwise → `fraction = (totalSize - totalSizeLeft) / totalSize`,
 *   clamped to `[0, 1]`.
 */
export async function fetchJellyseerrDownloadProgress(
  args: { baseUrl: string; tmdbId: number; mediaType: "movie" | "tv" },
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<DownloadProgress | undefined> {
  const url = joinPath(args.baseUrl, `/api/v1/${args.mediaType}/${args.tmdbId}`);
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new JellyseerrRequestError(`/api/v1/${args.mediaType}/${args.tmdbId}`, response.status);
  }
  const raw = (await response.json()) as RawMediaDetailWithInfo;
  const entries = raw.mediaInfo?.downloadStatus;
  if (!Array.isArray(entries) || entries.length === 0) return undefined;

  let totalSize = 0;
  let totalSizeLeft = 0;
  let firstStatus: string | undefined;
  let firstTimeLeft: string | undefined;
  for (const entry of entries) {
    const size = typeof entry.size === "number" ? entry.size : 0;
    const sizeLeft = typeof entry.sizeLeft === "number" ? entry.sizeLeft : 0;
    totalSize += size;
    totalSizeLeft += sizeLeft;
    if (firstStatus === undefined && typeof entry.status === "string") {
      firstStatus = entry.status;
    }
    if (firstTimeLeft === undefined && typeof entry.timeLeft === "string") {
      firstTimeLeft = entry.timeLeft;
    }
  }

  if (totalSize <= 0) {
    return {
      fraction: -1,
      status: firstStatus ?? "queued",
      timeLeft: firstTimeLeft,
    };
  }
  const rawFraction = (totalSize - totalSizeLeft) / totalSize;
  const fraction = Math.max(0, Math.min(1, rawFraction));
  return {
    fraction,
    status: firstStatus ?? "downloading",
    timeLeft: firstTimeLeft,
  };
}

/**
 * Pull the `connect.sid` value out of one or more `Set-Cookie` header
 * lines. Handles both the single-header case (`Headers.get("set-cookie")`
 * returns one cookie line) and the comma-joined case (multiple
 * Set-Cookie headers collapsed into one string per the Fetch spec).
 */
export function extractConnectSid(setCookieHeader: string | null): string | undefined {
  if (!setCookieHeader) return undefined;
  // Split on commas that aren't inside a cookie attribute value. The
  // Fetch spec collapses multiple Set-Cookie headers with comma-space
  // separators; a cookie *attribute* can never contain a comma (per
  // RFC 6265 §4.1.1), so a plain `, ` split is safe enough for the
  // shapes Jellyseerr actually returns.
  const parts = setCookieHeader.split(/,\s*(?=[^=]+=)/);
  for (const part of parts) {
    const match = /^\s*connect\.sid=([^;]+)/.exec(part);
    if (match) return match[1];
  }
  return undefined;
}
