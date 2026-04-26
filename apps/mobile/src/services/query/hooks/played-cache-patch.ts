import { mediaIdJellyfin, type MediaItem, type UserItemData } from "@jellyfuse/models";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Pure helpers used by `useTogglePlayedState` to patch every cached
 * `MediaItem` matching a played-state toggle and to drive the
 * post-settled invalidation. Split out from the hook file so they
 * can be tested under Jest without the hook's `react-native-nitro-fetch`
 * import graph.
 */

/**
 * `true` if `key` belongs to a family that has to be patched + invalidated
 * when played state flips:
 * - every home shelf (`["home", uid, *]`) — Continue Watching / Next Up
 *   change membership (a played item drops out), but the same `MediaItem`
 *   also lives in Recently Added / Latest Movies / Latest TV /
 *   Suggestions, where the badge + progress bar still need to flip.
 *   Easier and safer to patch them all than to enumerate which shelves
 *   carry which item.
 * - the three detail families (`["detail", uid, "movie"|"series"|"season-episodes", id]`)
 * - every paginated "see all" shelf (`["shelf", uid, shelfKey]`) — backs
 *   the `shelf-screen` grid via `useShelfInfinite`; without it the grid
 *   stays stale until the user scrolls or pulls to refresh.
 */
export function isAffectedQuery(query: { queryKey: QueryKey }): boolean {
  const k = query.queryKey;
  if (!Array.isArray(k) || k.length < 3) return false;
  const [root, , kind] = k as readonly unknown[];
  if (root === "home") return true;
  if (root === "detail") {
    return kind === "movie" || kind === "series" || kind === "season-episodes";
  }
  if (root === "shelf") return true;
  return false;
}

export function invalidateAffected(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ predicate: isAffectedQuery });
}

/**
 * Returns a new cache value with the played-state patch applied to
 * any `MediaItem` matching `itemId` (or, for season-episode lists,
 * any episode whose `seriesId` matches). Returns the input
 * untouched (referentially equal) when nothing matched, so callers
 * can skip the `setQueryData` write.
 *
 * Shapes handled:
 * - `MediaItem`         (movie / series detail single-item slot)
 * - `MediaItem[]`       (home shelves, season episodes)
 * - `{ items: MediaItem[], … }`   (one `ShelfPage` from `fetchShelfPage`)
 * - `{ pages: ShelfPage[], pageParams }` (`useInfiniteQuery` outer shape
 *   used by the "see all" grid in `shelf-screen`)
 */
export function patchCache(
  cache: unknown,
  itemId: string,
  seriesId: string | undefined,
  next: boolean,
): unknown {
  if (Array.isArray(cache)) {
    return patchMediaItemArray(cache, itemId, seriesId, next);
  }
  if (isMediaItem(cache)) {
    return patchMediaItemPlayed(cache, itemId, seriesId, next);
  }
  if (isShelfPageLike(cache)) {
    const patchedItems = patchMediaItemArray(cache.items, itemId, seriesId, next);
    return patchedItems === cache.items ? cache : { ...cache, items: patchedItems };
  }
  if (isInfinitePageBag(cache)) {
    let mutated = false;
    const pages = cache.pages.map((page) => {
      if (!isShelfPageLike(page)) return page;
      const patchedItems = patchMediaItemArray(page.items, itemId, seriesId, next);
      if (patchedItems === page.items) return page;
      mutated = true;
      return { ...page, items: patchedItems };
    });
    return mutated ? { ...cache, pages } : cache;
  }
  return cache;
}

function patchMediaItemArray(
  cache: readonly unknown[],
  itemId: string,
  seriesId: string | undefined,
  next: boolean,
): readonly unknown[] {
  let mutated = false;
  const out = cache.map((entry) => {
    if (!isMediaItem(entry)) return entry;
    const patched = patchMediaItemPlayed(entry, itemId, seriesId, next);
    if (patched !== entry) mutated = true;
    return patched;
  });
  return mutated ? out : cache;
}

/**
 * Patches a single `MediaItem` if its id (or its `seriesId`) matches.
 * Mirrors Jellyfin server behaviour: marking played sets `played=true`,
 * bumps `playCount` to at least 1, and stamps `lastPlayedDate=now`
 * (resume position is preserved server-side, so we leave `progress`
 * and `playbackPositionTicks` alone). Marking unplayed resets all of
 * those — including the resume point — matching the server's
 * `DELETE /PlayedItems` semantics.
 */
export function patchMediaItemPlayed(
  item: MediaItem,
  itemId: string,
  seriesId: string | undefined,
  next: boolean,
): MediaItem {
  const directHit = mediaIdJellyfin(item.id) === itemId;
  // Patch parent series detail when an episode toggle bubbles up: only
  // bump `lastPlayedDate` so UI relative timestamps update — the more
  // expensive aggregate fields (UnplayedItemCount, etc.) are left to
  // the post-settled refetch.
  const seriesHit = seriesId !== undefined && mediaIdJellyfin(item.id) === seriesId;
  if (!directHit && !seriesHit) return item;

  const previousUserData: UserItemData = item.userData ?? {
    played: !next,
    playCount: 0,
    playbackPositionTicks: 0,
    isFavorite: false,
    lastPlayedDate: undefined,
    unplayedItemCount: undefined,
  };

  const userData: UserItemData = directHit
    ? next
      ? {
          ...previousUserData,
          played: true,
          playCount: Math.max(1, previousUserData.playCount),
          lastPlayedDate: new Date().toISOString(),
        }
      : {
          ...previousUserData,
          played: false,
          playCount: 0,
          playbackPositionTicks: 0,
          lastPlayedDate: undefined,
        }
    : { ...previousUserData, lastPlayedDate: new Date().toISOString() };

  return {
    ...item,
    userData,
    progress: directHit && !next ? 0 : item.progress,
  };
}

function isMediaItem(value: unknown): value is MediaItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "mediaType" in value &&
    "title" in value
  );
}

function isShelfPageLike(value: unknown): value is { items: MediaItem[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray((value as { items: unknown }).items)
  );
}

function isInfinitePageBag(value: unknown): value is { pages: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "pages" in value &&
    Array.isArray((value as { pages: unknown }).pages)
  );
}
