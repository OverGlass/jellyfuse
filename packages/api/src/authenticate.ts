import { buildAuthHeader, type AuthContext } from "./auth-header";
import type { FetchLike } from "./system-info";

/**
 * Authenticated user payload returned by Jellyfin after a successful
 * `AuthenticateByName` call. Mirrors the shape we actually need — the
 * Rust crate extracts the same three fields from `AuthenticationResult`
 * in `crates/jf-api/src/jellyfin.rs`.
 */
export interface AuthenticatedUser {
  userId: string;
  userName: string;
  accessToken: string;
}

export class AuthenticateHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Jellyfin AuthenticateByName returned HTTP ${status}`);
    this.name = "AuthenticateHttpError";
    this.status = status;
  }
}

export class AuthenticateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticateParseError";
  }
}

export interface AuthenticateInput {
  /** Jellyfin server base URL, e.g. `https://jellyfin.example.com` */
  baseUrl: string;
  /** Login name — Jellyfin accepts usernames, not email. */
  username: string;
  /** Plaintext password; the server hashes it on arrival. */
  password: string;
  /**
   * Device info to embed in the `X-Emby-Authorization` header. The device
   * id must come from `services/device-id` so it stays stable across
   * sessions (see CLAUDE.md "Device ID" rule).
   */
  authContext: Omit<AuthContext, "token">;
}

/**
 * POST `/Users/AuthenticateByName`. Ports the Rust call in
 * `crates/jf-api/src/jellyfin.rs`. Returns the access token + user id +
 * display name so the caller can persist them in secure-storage and
 * start building authenticated request headers.
 */
export async function authenticateByName(
  input: AuthenticateInput,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<AuthenticatedUser> {
  const url = joinPath(input.baseUrl, "/Users/AuthenticateByName");

  // The initial call is pre-authentication — no token yet — but the
  // Jellyfin server still expects the full `X-Emby-Authorization`
  // header with the device id so the resulting session is attributed
  // to this client.
  const headerValue = buildAuthHeader({ ...input.authContext, token: undefined });

  const body = JSON.stringify({ Username: input.username, Pw: input.password });

  const response = await fetcherWithInit(fetcher, url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Emby-Authorization": headerValue,
    },
    body,
    signal,
  });

  if (!response.ok) {
    throw new AuthenticateHttpError(response.status);
  }

  const raw = await response.json();
  if (!isRawAuthResult(raw)) {
    throw new AuthenticateParseError("Unexpected response shape from /Users/AuthenticateByName");
  }
  return {
    userId: raw.User.Id,
    userName: raw.User.Name,
    accessToken: raw.AccessToken,
  };
}

function joinPath(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/**
 * Fetch initializer type the authenticate call needs. It's a superset
 * of the minimal `FetchLike` used by `getSystemInfoPublic` (we also
 * need method, headers, and body), so we extend it here inline rather
 * than widening the shared `FetchLike` with optional fields that
 * other endpoints don't use.
 */
interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal | undefined;
}

async function fetcherWithInit(
  fetcher: FetchLike,
  url: string,
  init: FetchInit,
): Promise<Awaited<ReturnType<FetchLike>>> {
  // `FetchLike` is intentionally narrow (only `signal` in init) to keep
  // the GET-only system-info fetcher simple. Nitro Fetch and `globalThis
  // .fetch` both accept the full Request init shape at runtime, so a cast
  // to the broader callable is safe here and kept local to the auth path.
  const wideFetcher = fetcher as (
    input: string,
    init: FetchInit,
  ) => Promise<Awaited<ReturnType<FetchLike>>>;
  return wideFetcher(url, init);
}

interface RawAuthResult {
  User: { Id: string; Name: string };
  AccessToken: string;
}

function isRawAuthResult(value: unknown): value is RawAuthResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v["AccessToken"] !== "string") return false;
  const user = v["User"];
  if (typeof user !== "object" || user === null) return false;
  const u = user as Record<string, unknown>;
  return typeof u["Id"] === "string" && typeof u["Name"] === "string";
}
