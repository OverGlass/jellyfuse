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
