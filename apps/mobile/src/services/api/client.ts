import { buildAuthHeader, type AuthContext, type FetchLike } from "@jellyfuse/api";
import { fetch as nitroFetch } from "react-native-nitro-fetch";
import { buildAuthContextForUser } from "@/services/auth/auth-context-builder";
import {
  findActiveUser,
  PERSISTED_AUTH_KEY,
  type PersistedAuth,
} from "@/services/auth/persisted-auth";
import { queryClient } from "@/services/query/client";

/**
 * App-side HTTP fetchers. Always routed through `react-native-nitro-fetch`
 * per CLAUDE.md's "No raw `fetch`" rule — Nitro Fetch uses URLSession on
 * iOS / tvOS / Catalyst and Cronet on Android under the hood, supports
 * HTTP/2 + HTTP/3, and runs on the native thread so we don't block JS.
 *
 * Two variants:
 *
 * - `apiFetch` — pre-auth. Used by `useSystemInfo` on the server-connect
 *   screen, and by `authenticateByName` / `jellyseerrLogin` during
 *   sign-in.
 *
 * - `apiFetchAuthenticated` — post-auth. Reads the active user from the
 *   React Query cache at `['auth', 'persisted']`, resolves the auth
 *   context via `queryClient.fetchQuery(['auth', 'context', userId])`,
 *   and injects `X-Emby-Authorization` on every request. No
 *   module-level refs, no useEffect — the cache is the single source
 *   of truth, read via React Query's out-of-React helpers.
 *
 * Packages in `packages/api` stay pure TS and take the fetcher as an
 * argument, which keeps them unit-testable against MSW / fake fetchers
 * in Vitest.
 */

export const apiFetch: FetchLike = (input, init) => {
  return nitroFetch(input, init);
};

export class NoActiveUserError extends Error {
  constructor() {
    super("apiFetchAuthenticated called with no active user in the auth cache");
    this.name = "NoActiveUserError";
  }
}

export const apiFetchAuthenticated: FetchLike = async (input, init) => {
  const persisted = queryClient.getQueryData<PersistedAuth>(PERSISTED_AUTH_KEY);
  const activeUser = findActiveUser(persisted);
  if (!activeUser) {
    throw new NoActiveUserError();
  }

  // `fetchQuery` returns a cached context instantly when available and
  // builds+caches on the first call per user. De-duped across concurrent
  // callers by React Query, and re-keyed by userId so a user switch
  // gives us a fresh context automatically.
  const authContext = await queryClient.fetchQuery<AuthContext>({
    queryKey: ["auth", "context", activeUser.userId] as const,
    queryFn: () => buildAuthContextForUser(activeUser),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });

  // Widen init locally so we can set headers — FetchLike's init is
  // intentionally narrow (signal-only); Nitro Fetch accepts the broader
  // shape at runtime.
  const wideInit = (init ?? {}) as {
    signal?: AbortSignal;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  const headers: Record<string, string> = {
    ...wideInit.headers,
    "X-Emby-Authorization": buildAuthHeader(authContext),
  };
  return nitroFetch(input, { ...wideInit, headers });
};
