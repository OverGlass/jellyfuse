// React Query hook for fetching PlaybackInfo. Follows the same
// pattern as useMovieDetail — pure query, no side effects.

import { fetchPlaybackInfo } from "@jellyfuse/api";
import type { PlaybackInfo } from "@jellyfuse/models";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetchAuthenticated } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";

/**
 * Fetches PlaybackInfo for an item via React Query. The query is
 * NOT persisted (excluded in should-dehydrate.ts) since playback
 * info is volatile and should be fresh every time.
 */
export function usePlaybackInfo(jellyfinId: string | undefined): UseQueryResult<PlaybackInfo> {
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;
  const token = activeUser?.token;

  return useQuery({
    queryKey: ["playback", userId ?? "", "info", jellyfinId ?? ""],
    queryFn: ({ signal }) => {
      if (!serverUrl || !userId || !token || !jellyfinId) {
        throw new Error("usePlaybackInfo called without full auth context");
      }
      return fetchPlaybackInfo(
        { baseUrl: serverUrl, userId, token, itemId: jellyfinId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: Boolean(serverUrl && userId && token && jellyfinId),
    staleTime: 0, // Always fresh — playback info is volatile
    gcTime: 0, // Don't cache after unmount
    retry: 1,
  });
}
