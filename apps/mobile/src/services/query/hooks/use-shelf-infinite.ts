import { fetchShelfPage, type ShelfPage, type ShelfPageKey } from "@jellyfuse/api";
import { queryKeys } from "@jellyfuse/query-keys";
import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from "@tanstack/react-query";
import { apiFetchAuthenticated } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";

/**
 * Infinite query for the shelf "see all" grid. Wraps `fetchShelfPage`
 * in `useInfiniteQuery` keyed by `queryKeys.shelfPage(userId, shelfKey)`.
 * Page size 50, `getNextPageParam` returns the server-provided
 * `nextStartIndex` (undefined → no more pages, RQ stops calling).
 *
 * Disabled until the auth context is ready — matches the home shelf
 * hooks in this directory.
 */

const PAGE_SIZE = 50;

export function useShelfInfinite(
  shelfKey: ShelfPageKey | undefined,
): UseInfiniteQueryResult<InfiniteData<ShelfPage, number>, Error> {
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;

  return useInfiniteQuery({
    queryKey: queryKeys.shelfPage(userId ?? "", shelfKey ?? "latest-movies"),
    queryFn: ({ pageParam, signal }) => {
      if (!serverUrl || !userId || !shelfKey) {
        throw new Error("useShelfInfinite called without full auth context");
      }
      return fetchShelfPage(
        {
          baseUrl: serverUrl,
          userId,
          shelfKey,
          startIndex: pageParam,
          limit: PAGE_SIZE,
        },
        apiFetchAuthenticated,
        signal,
      );
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextStartIndex,
    enabled: Boolean(serverUrl && userId && shelfKey),
  });
}
