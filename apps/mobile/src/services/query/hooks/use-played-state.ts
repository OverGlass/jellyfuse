import { markItemPlayed, unmarkItemPlayed } from "@jellyfuse/api";
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiFetchAuthenticated } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";
import { invalidateAffected, isAffectedQuery, patchCache } from "./played-cache-patch";

/**
 * `POST|DELETE /Users/{userId}/PlayedItems/{itemId}` mutation. Patches
 * every cached `MediaItem` matching the toggled item across the five
 * affected query families before the network round-trip (optimistic),
 * rolls back on error, then predicate-invalidates so any list that
 * depends on played state (Continue Watching, Next Up) refetches with
 * a fresh ranking. Mirrors the Rust spec in
 * `crates/jf-core/src/query.rs::QueryKey::stale_time` and the local
 * "Optimistic + invalidate-on-success" rule.
 */

export interface ToggleArgs {
  itemId: string;
  /** Target state. `true` = mark watched, `false` = mark unwatched. */
  next: boolean;
  /**
   * When toggling an episode, also patch the parent series detail and
   * any season-episode list keyed by `seriesId`. Optional because
   * movie / series-level toggles don't need it.
   */
  seriesId?: string;
}

interface MutationContext {
  /** Snapshots of every cache slot we patched, keyed by query key. */
  snapshots: { key: QueryKey; data: unknown }[];
}

export function useTogglePlayedState(): UseMutationResult<
  void,
  Error,
  ToggleArgs,
  MutationContext
> {
  const queryClient = useQueryClient();
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;

  return useMutation<void, Error, ToggleArgs, MutationContext>({
    mutationFn: async ({ itemId, next }) => {
      if (!serverUrl || !userId) {
        throw new Error("useTogglePlayedState called without full auth context");
      }
      const fn = next ? markItemPlayed : unmarkItemPlayed;
      await fn({ baseUrl: serverUrl, userId, itemId }, apiFetchAuthenticated);
    },

    onMutate: async ({ itemId, next, seriesId }): Promise<MutationContext> => {
      // Cancel any in-flight refetch on the affected families so the
      // optimistic patch isn't overwritten when the response lands.
      await queryClient.cancelQueries({ predicate: isAffectedQuery });

      const snapshots: { key: QueryKey; data: unknown }[] = [];
      const matches = queryClient.getQueriesData<unknown>({ predicate: isAffectedQuery });
      for (const [key, data] of matches) {
        snapshots.push({ key, data });
        const patched = patchCache(data, itemId, seriesId, next);
        if (patched !== data) {
          queryClient.setQueryData(key, patched);
        }
      }
      return { snapshots };
    },

    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const { key, data } of context.snapshots) {
        queryClient.setQueryData(key, data);
      }
    },

    onSettled: () => {
      // Refetch every shelf + detail family so list ordering and any
      // server-derived fields we don't model client-side land. Keys
      // are already userId-scoped, so this only touches the active
      // user's caches.
      void invalidateAffected(queryClient);
    },
  });
}
