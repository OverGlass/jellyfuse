import { buildAuthHeader, type AuthContext, type FetchLike } from "@jellyfuse/api";
import { fetch as nitroFetch } from "react-native-nitro-fetch";

/**
 * App-side HTTP fetchers. Always routed through `react-native-nitro-fetch`
 * per CLAUDE.md's "No raw `fetch`" rule — Nitro Fetch uses URLSession on
 * iOS / tvOS / Catalyst and Cronet on Android under the hood, supports
 * HTTP/2 + HTTP/3, and runs on the native thread so we don't block JS.
 *
 * Two variants:
 *
 * - `apiFetch` — pre-auth. Used by `useSystemInfo` on the server-connect
 *   screen, and by `authenticateByName` during sign-in.
 *
 * - `apiFetchAuthenticated` — post-auth. Injects the Jellyfin
 *   `X-Emby-Authorization` header built from the **currently active**
 *   user's token + device id. The context lives in a module-level ref
 *   that `AuthProvider` keeps in sync via an effect whenever the active
 *   user changes; call sites don't thread the token through every layer.
 *
 * Packages in `packages/api` stay pure TS and take the fetcher as an
 * argument, which keeps them unit-testable against MSW / fake fetchers
 * in Vitest.
 */

export const apiFetch: FetchLike = (input, init) => {
  return nitroFetch(input, init);
};

let currentAuthContext: AuthContext | undefined;

/**
 * Register (or clear) the auth context used by `apiFetchAuthenticated`.
 * Called by `AuthProvider` whenever the active user changes. Clearing
 * (`undefined`) is used on sign-out and during user-switch transitions.
 */
export function setCurrentAuthContext(ctx: AuthContext | undefined): void {
  currentAuthContext = ctx;
}

/**
 * Jellyfin-authenticated fetcher. Every call is wrapped to inject the
 * `X-Emby-Authorization` header; callers don't build auth headers by
 * hand. Throws if invoked before the auth context has been registered —
 * that's always a programming error (a screen in the `(app)` group
 * fired a query before `AuthProvider` hydrated).
 */
export const apiFetchAuthenticated: FetchLike = (input, init) => {
  if (!currentAuthContext) {
    throw new Error(
      "apiFetchAuthenticated called with no auth context — use apiFetch for pre-auth endpoints",
    );
  }
  // Widen the init locally so we can set headers. FetchLike's init is
  // intentionally narrow (signal-only); Nitro Fetch + the global fetch
  // both accept the broader init shape at runtime.
  const wideInit = (init ?? {}) as {
    signal?: AbortSignal;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  const headers: Record<string, string> = {
    ...wideInit.headers,
    "X-Emby-Authorization": buildAuthHeader(currentAuthContext),
  };
  return nitroFetch(input, { ...wideInit, headers });
};
