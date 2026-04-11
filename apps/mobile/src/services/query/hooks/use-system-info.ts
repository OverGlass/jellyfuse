import { getSystemInfoPublic, type SystemInfoPublic } from "@jellyfuse/api";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch } from "@/services/api/client";

/**
 * Fetches Jellyfin `/System/Info/Public` for a given base URL. Used on the
 * server-connect screen to validate the URL + show the server identity
 * before we prompt for credentials.
 *
 * Phase 0b.3 routes the hook through Nitro Fetch (`apiFetch`). Phase 1
 * feeds `baseUrl` from the AuthContext flow instead of the hard-coded
 * demo URL.
 */
export function useSystemInfo(baseUrl: string | undefined): UseQueryResult<SystemInfoPublic> {
  return useQuery({
    queryKey: queryKeys.systemInfo(baseUrl ?? ""),
    queryFn: ({ signal }) => {
      if (!baseUrl) {
        throw new Error("useSystemInfo called without a base URL");
      }
      return getSystemInfoPublic(baseUrl, apiFetch, signal);
    },
    enabled: Boolean(baseUrl),
    staleTime: STALE_TIMES.systemInfo,
  });
}
