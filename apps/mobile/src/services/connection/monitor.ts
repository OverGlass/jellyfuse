import { getSystemInfoPublic } from "@jellyfuse/api";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";

/**
 * Connection status derived from a periodic ping of Jellyfin's
 * `/System/Info/Public` endpoint. No native `NetInfo` dependency —
 * the server ping is more accurate anyway (OS-level online ≠ my
 * Jellyfin actually reachable).
 *
 * Shares the `system-info` query key with `useSystemInfo` so the
 * cache entry is unified: both subscribers see the same data and
 * `queryClient.invalidateQueries(['system-info'])` fires a single
 * refetch. The difference is the `refetchInterval`: this hook keeps
 * re-pinging every 30 s while the app is focused so the banner
 * disappears within 30 s of reconnecting.
 *
 * Statuses:
 *
 * - `connecting` — no result yet on cold boot (query is pending).
 * - `online`    — most recent ping returned OK.
 * - `offline`   — ping errored (network down, server unreachable, 5xx).
 */

export type ConnectionStatus = "connecting" | "online" | "offline";

const REFETCH_INTERVAL_MS = 30_000;

export function useConnectionStatus(): ConnectionStatus {
  const { serverUrl } = useAuth();

  const ping = useQuery({
    queryKey: queryKeys.systemInfo(serverUrl ?? ""),
    queryFn: ({ signal }) => {
      if (!serverUrl) throw new Error("useConnectionStatus called without a server URL");
      return getSystemInfoPublic(serverUrl, apiFetch, signal);
    },
    enabled: Boolean(serverUrl),
    staleTime: STALE_TIMES.systemInfo,
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  if (ping.isError) return "offline";
  if (ping.data) return "online";
  return "connecting";
}
