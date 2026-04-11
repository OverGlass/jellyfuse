import type { FetchLike } from "@jellyfuse/api";
import { fetch as nitroFetch } from "react-native-nitro-fetch";
import {
  findActiveUser,
  PERSISTED_AUTH_KEY,
  type PersistedAuth,
} from "@/services/auth/persisted-auth";
import { queryClient } from "@/services/query/client";

/**
 * Jellyseerr-authenticated HTTP fetcher. Reads the `connect.sid`
 * cookie from the active user's `AuthenticatedUser` record in the
 * React Query cache at `['auth', 'persisted']`. No module-level refs,
 * no useEffect — the cache is the single source of truth, accessed
 * via `queryClient.getQueryData` from outside React.
 *
 * Jellyseerr is optional in Jellyfuse (per the auth architecture
 * memory). If the active user has no cookie, callers get a
 * `JellyseerrNotConnectedError` synchronously so feature screens
 * render their "not configured" state gracefully.
 *
 * A 401 from the server surfaces as `JellyseerrSessionExpiredError`
 * so the connection monitor (Phase 2) can trigger the reconnect
 * banner.
 */

export class JellyseerrNotConnectedError extends Error {
  constructor() {
    super("Jellyseerr is not connected — active user has no connect.sid cookie");
    this.name = "JellyseerrNotConnectedError";
  }
}

export class JellyseerrSessionExpiredError extends Error {
  constructor() {
    super("Jellyseerr session expired — the server returned 401");
    this.name = "JellyseerrSessionExpiredError";
  }
}

export const jellyseerrFetch: FetchLike = async (input, init) => {
  const persisted = queryClient.getQueryData<PersistedAuth>(PERSISTED_AUTH_KEY);
  const activeUser = findActiveUser(persisted);
  const cookie = activeUser?.jellyseerrCookie;
  if (!cookie) {
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
    Cookie: `connect.sid=${cookie}`,
  };
  const response = await nitroFetch(input, { ...wideInit, headers });
  if (response.status === 401) {
    throw new JellyseerrSessionExpiredError();
  }
  return response;
};
