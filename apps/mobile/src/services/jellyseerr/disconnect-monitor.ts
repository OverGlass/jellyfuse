import { handleJellyseerrSessionExpired } from "@/services/auth/state";
import { queryClient } from "@/services/query/client";
import { JellyseerrSessionExpiredError } from "./client";

/**
 * Subscribes to the global QueryCache and converts a 401-from-Jellyseerr
 * (typed as `JellyseerrSessionExpiredError` by `jellyseerrFetch`) into
 * an app-wide disconnected state.
 *
 * Wiring this once at module load is the simplest way to make every
 * `useQuery` / `useQueries` call participate without sprinkling
 * `onError` handlers on each Jellyseerr hook. The cache fires the
 * `updated` event whenever a query settles, so the listener fires
 * exactly once per failed fetch.
 *
 * Called from `app/_layout.tsx` for its side effect, after the i18n
 * polyfill but before any screen subscribes to a Jellyseerr query.
 */
export function installJellyseerrDisconnectMonitor(): () => void {
  const cache = queryClient.getQueryCache();
  return cache.subscribe((event) => {
    if (event.type !== "updated") return;
    const error = event.query.state.error;
    if (!(error instanceof JellyseerrSessionExpiredError)) return;
    void handleJellyseerrSessionExpired(queryClient, error.message).catch((err: unknown) => {
      console.warn("handleJellyseerrSessionExpired failed", err);
    });
  });
}
