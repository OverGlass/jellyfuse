import { getSystemInfoPublic, type SystemInfoPublic } from "@jellyfuse/api";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

/**
 * Fetches Jellyfin `/System/Info/Public` for a given base URL. Used on the
 * server-connect screen to validate the URL + show the server identity
 * before we prompt for credentials.
 *
 * Phase 0b.2 wires the hook end-to-end against the real endpoint; Phase 1
 * feeds it from the AuthContext flow.
 */
export function useSystemInfo(baseUrl: string | undefined): UseQueryResult<SystemInfoPublic> {
  return useQuery({
    queryKey: queryKeys.systemInfo(baseUrl ?? ""),
    queryFn: ({ signal }) => {
      if (!baseUrl) {
        throw new Error("useSystemInfo called without a base URL");
      }
      return getSystemInfoPublic(baseUrl, globalThis.fetch as never, signal);
    },
    enabled: Boolean(baseUrl),
    staleTime: STALE_TIMES.systemInfo,
  });
}
