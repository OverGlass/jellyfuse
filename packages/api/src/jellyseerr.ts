import type {
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
