import { fetchSeriesNextUpEpisode } from "@jellyfuse/api";
import type { MediaItem } from "@jellyfuse/models";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetchAuthenticated } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";

/**
 * Resolve the user's resume-target episode for a single series. Backs
 * the long-press action sheet's "Mark current episode / Mark current
 * season" rows so the gesture can target a specific episode/season
 * id instead of cascading the whole show.
 *
 * Same staleness as the global Next Up shelf. Disabled until both
 * auth context and a `seriesId` are available.
 */
export function useSeriesNextUpEpisode(
  seriesId: string | undefined,
): UseQueryResult<MediaItem | null> {
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;
  return useQuery({
    queryKey: queryKeys.seriesNextUp(userId ?? "", seriesId ?? ""),
    queryFn: ({ signal }) => {
      if (!serverUrl || !userId || !seriesId) {
        throw new Error("useSeriesNextUpEpisode called without full auth context");
      }
      return fetchSeriesNextUpEpisode(
        { baseUrl: serverUrl, userId, seriesId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: Boolean(serverUrl && userId && seriesId),
    staleTime: STALE_TIMES.seriesNextUp,
  });
}
