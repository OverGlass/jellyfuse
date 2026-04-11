import type { FetchLike } from "@jellyfuse/api";
import { fetch as nitroFetch } from "react-native-nitro-fetch";

/**
 * Jellyseerr-authenticated HTTP fetcher. Every call injects a
 * `Cookie: connect.sid=<value>` header from the module-level ref that
 * `AuthProvider` keeps in sync via `setCurrentJellyseerrCookie`.
 *
 * Jellyseerr is optional in Jellyfuse (per the Rust spec) — if no
 * cookie is registered, callers get a `JellyseerrNotConnectedError`
 * synchronously so feature screens can render their "not configured"
 * state gracefully instead of firing a doomed request.
 *
 * A 401 from the server is surfaced as `JellyseerrSessionExpiredError`
 * so the connection monitor (Phase 2) can trigger the reconnect banner.
 */

export class JellyseerrNotConnectedError extends Error {
  constructor() {
    super("Jellyseerr is not connected — no connect.sid cookie registered");
    this.name = "JellyseerrNotConnectedError";
  }
}

export class JellyseerrSessionExpiredError extends Error {
  constructor() {
    super("Jellyseerr session expired — the server returned 401");
    this.name = "JellyseerrSessionExpiredError";
  }
}

let currentCookie: string | undefined;

/**
 * Register (or clear) the `connect.sid` used by `jellyseerrFetch`.
 * `undefined` clears the cookie — used on sign-out and when Jellyseerr
 * fails to log in during the Jellyfin sign-in chain.
 */
export function setCurrentJellyseerrCookie(cookie: string | undefined): void {
  currentCookie = cookie;
}

export const jellyseerrFetch: FetchLike = async (input, init) => {
  if (!currentCookie) {
    throw new JellyseerrNotConnectedError();
  }
  const wideInit = (init ?? {}) as {
    signal?: AbortSignal;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  const headers: Record<string, string> = {
    ...wideInit.headers,
    Cookie: `connect.sid=${currentCookie}`,
  };
  const response = await nitroFetch(input, { ...wideInit, headers });
  if (response.status === 401) {
    throw new JellyseerrSessionExpiredError();
  }
  return response;
};
