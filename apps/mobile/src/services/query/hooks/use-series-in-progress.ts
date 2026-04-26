import type { MediaItem } from "@jellyfuse/models";
import { queryKeys } from "@jellyfuse/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/services/auth/state";

/**
 * Returns `true` when the active user has any in-progress or queued
 * episode for `seriesId`. Cross-references the Continue Watching and
 * Next Up caches — the same data that drives the À suivre / Next Up
 * shelves, so the answer matches what the user already sees on Home.
 *
 * Why not rely on `UserData.UnplayedItemCount` / `LastPlayedDate` /
 * `PlayCount` on the series item itself? Jellyfin only decrements
 * `UnplayedItemCount` and increments `PlayCount` when an episode is
 * **fully** watched, and `/Items/Latest` and `/Items?SortBy=DateCreated`
 * leave them unchanged even when the user is mid-watch on an episode.
 * Returns `false` cheaply when `seriesId` is undefined or no auth
 * context — safe to call unconditionally from a list item.
 *
 * Synchronous read of the React Query cache, no fetcher subscription.
 * When Continue Watching / Next Up are invalidated (player Stop /
 * mark played) the consumer re-renders via the parent screen's
 * existing query subscriptions.
 */
export function useIsSeriesInProgress(seriesId: string | undefined): boolean {
  const queryClient = useQueryClient();
  const { activeUser } = useAuth();
  const userId = activeUser?.userId;
  if (!userId || !seriesId) return false;

  const continueWatching = queryClient.getQueryData<MediaItem[]>(
    queryKeys.continueWatching(userId),
  );
  if (continueWatching?.some((episode) => episode.seriesId === seriesId)) {
    return true;
  }
  const nextUp = queryClient.getQueryData<MediaItem[]>(queryKeys.nextUp(userId));
  return Boolean(nextUp?.some((episode) => episode.seriesId === seriesId));
}
