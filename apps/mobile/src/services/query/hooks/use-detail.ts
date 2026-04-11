import { fetchEpisodes, fetchItemDetail, fetchSeasons, type MediaItem } from "@jellyfuse/api";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetchAuthenticated } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";

/**
 * Detail hooks. All three are scoped by `userId` so `queryClient.clear()`
 * on user switch is the right invalidation. Each disables itself until
 * auth context is ready.
 *
 * - `useMovieDetail` / `useSeriesDetail` wrap `GET /Users/{uid}/Items/{id}`
 *   (Jellyfin returns the full metadata for both the same way — the
 *   returned `mediaType` discriminates). We keep the key separate so
 *   cache invalidation can target "all movies" vs "all series" later.
 * - `useSeasons` wraps `GET /Shows/{seriesId}/Seasons`.
 * - `useEpisodes` wraps `GET /Shows/{seriesId}/Episodes?SeasonId=…` and
 *   is disabled until the caller has picked an active season.
 *
 * React Compiler handles memoisation; plain `useQuery` calls only.
 */

export function useMovieDetail(jellyfinId: string | undefined): UseQueryResult<MediaItem> {
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;
  return useQuery({
    queryKey: queryKeys.movieDetail(userId ?? "", jellyfinId ?? ""),
    queryFn: ({ signal }) => {
      if (!serverUrl || !userId || !jellyfinId) {
        throw new Error("useMovieDetail called without full auth context");
      }
      return fetchItemDetail(
        { baseUrl: serverUrl, userId, itemId: jellyfinId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: Boolean(serverUrl && userId && jellyfinId),
    staleTime: STALE_TIMES.movieDetail,
  });
}

export function useSeriesDetail(jellyfinId: string | undefined): UseQueryResult<MediaItem> {
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;
  return useQuery({
    queryKey: queryKeys.seriesDetail(userId ?? "", jellyfinId ?? ""),
    queryFn: ({ signal }) => {
      if (!serverUrl || !userId || !jellyfinId) {
        throw new Error("useSeriesDetail called without full auth context");
      }
      return fetchItemDetail(
        { baseUrl: serverUrl, userId, itemId: jellyfinId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: Boolean(serverUrl && userId && jellyfinId),
    staleTime: STALE_TIMES.seriesDetail,
  });
}

export function useSeasons(seriesId: string | undefined): UseQueryResult<MediaItem[]> {
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;
  return useQuery({
    // Reuse the season-episodes key family with a "seasons-of" prefix so
    // the two cache buckets don't collide.
    queryKey: queryKeys.seasonEpisodes(userId ?? "", `series:${seriesId ?? ""}`),
    queryFn: ({ signal }) => {
      if (!serverUrl || !userId || !seriesId) {
        throw new Error("useSeasons called without full auth context");
      }
      return fetchSeasons({ baseUrl: serverUrl, userId, seriesId }, apiFetchAuthenticated, signal);
    },
    enabled: Boolean(serverUrl && userId && seriesId),
    staleTime: STALE_TIMES.seasonEpisodes,
  });
}

export function useEpisodes(
  seriesId: string | undefined,
  seasonId: string | undefined,
): UseQueryResult<MediaItem[]> {
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;
  return useQuery({
    queryKey: queryKeys.seasonEpisodes(userId ?? "", seasonId ?? ""),
    queryFn: ({ signal }) => {
      if (!serverUrl || !userId || !seriesId || !seasonId) {
        throw new Error("useEpisodes called without full auth context");
      }
      return fetchEpisodes(
        { baseUrl: serverUrl, userId, seriesId, seasonId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: Boolean(serverUrl && userId && seriesId && seasonId),
    staleTime: STALE_TIMES.seasonEpisodes,
  });
}
