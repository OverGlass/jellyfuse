import { getSystemInfoPublic } from "@jellyfuse/api";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import { useQuery } from "@tanstack/react-query";
import { useNetworkState } from "expo-network";
import { apiFetch } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";

/**
 * Connection status combining two signals:
 *
 * 1. **OS network state** via `expo-network` — event-driven, fires
 *    instantly when the OS detects airplane mode / wifi drop /
 *    cellular handoff. Used as a fast short-circuit ("no network
 *    at all, definitely offline") and as a trigger to re-ping the
 *    server when the OS reports connectivity is back.
 *
 * 2. **Server ping** against `/System/Info/Public` — definitive
 *    reachability for *this Jellyfin server*. The OS can be online
 *    while the server is down or the LAN host is unreachable, so
 *    the ping is still the source of truth for the `online` state.
 *
 * Shares the `system-info` query key with `useSystemInfo` so both
 * subscribers see the same cached data.
 *
 * Statuses:
 *
 * - `connecting` — no result yet on cold boot (query is pending).
 * - `online`    — most recent ping returned OK.
 * - `offline`   — OS reports no connectivity, or the ping errored.
 */

export type ConnectionStatus = "connecting" | "online" | "offline";

const PING_TIMEOUT_MS = 5_000;
const REFETCH_INTERVAL_MS = 30_000;

export function useConnectionStatus(): ConnectionStatus {
  const { serverUrl } = useAuth();
  const network = useNetworkState();

  const ping = useQuery({
    queryKey: queryKeys.systemInfo(serverUrl ?? ""),
    queryFn: async ({ signal }) => {
      if (!serverUrl) throw new Error("useConnectionStatus called without a server URL");
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error("ping timed out")),
        PING_TIMEOUT_MS,
      );
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
      try {
        return await getSystemInfoPublic(serverUrl, apiFetch, controller.signal);
      } finally {
        clearTimeout(timer);
      }
    },
    enabled: Boolean(serverUrl),
    staleTime: STALE_TIMES.systemInfo,
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    // No retries — the interval is our retry cadence, and TanStack's
    // `onlineManager` (wired to expo-network in `query/client.ts`)
    // auto-resumes this query the moment the OS reports connectivity.
    retry: false,
  });

  // OS says there's no network at all → definitely offline, no
  // need to wait for the ping to time out. `isConnected === false`
  // is the strong signal; `isInternetReachable === false` is softer
  // (some networks don't report reachability), so we only trust the
  // hard "not connected" bit.
  if (network.isConnected === false) return "offline";

  if (ping.isError) return "offline";
  if (ping.data) return "online";
  return "connecting";
}
