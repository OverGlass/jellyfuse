import {
  fetchContinueWatching,
  fetchLatestMovies,
  fetchLatestTv,
  fetchNextUp,
  fetchRecentlyAdded,
  type MediaItem,
} from "@jellyfuse/api";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetchAuthenticated } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";

/**
 * Home-shelf hooks. Each wraps the corresponding `@jellyfuse/api`
 * fetcher in a React Query `useQuery` call, keyed by the active user
 * so `queryClient.clear()` on user switch is the right invalidation.
 *
 * Auth flow:
 * - `useAuth` gives us the active user + server URL.
 * - The query is disabled (`enabled: false`) until both are present —
 *   this happens during hydration and on the brief window between
 *   sign-in and home render.
 * - `apiFetchAuthenticated` injects the X-Emby-Authorization header on
 *   every request via Nitro Fetch, reading the auth context from the
 *   query cache with `queryClient.fetchQuery` (no refs, no useEffect).
 *
 * No `useCallback`/`useMemo` — React Compiler handles memoisation.
 */

interface HomeQueryContext {
  serverUrl: string | undefined;
  userId: string | undefined;
}

function useHomeContext(): HomeQueryContext {
  const { serverUrl, activeUser } = useAuth();
  return { serverUrl, userId: activeUser?.userId };
}

function canFetch(ctx: HomeQueryContext): ctx is { serverUrl: string; userId: string } {
  return ctx.serverUrl !== undefined && ctx.userId !== undefined;
}

export function useContinueWatching(): UseQueryResult<MediaItem[]> {
  const ctx = useHomeContext();
  return useQuery({
    queryKey: queryKeys.continueWatching(ctx.userId ?? ""),
    queryFn: ({ signal }) => {
      if (!canFetch(ctx)) {
        throw new Error("useContinueWatching called without auth context");
      }
      return fetchContinueWatching(
        { baseUrl: ctx.serverUrl, userId: ctx.userId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: canFetch(ctx),
    staleTime: STALE_TIMES.continueWatching,
  });
}

export function useNextUp(): UseQueryResult<MediaItem[]> {
  const ctx = useHomeContext();
  return useQuery({
    queryKey: queryKeys.nextUp(ctx.userId ?? ""),
    queryFn: ({ signal }) => {
      if (!canFetch(ctx)) {
        throw new Error("useNextUp called without auth context");
      }
      return fetchNextUp(
        { baseUrl: ctx.serverUrl, userId: ctx.userId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: canFetch(ctx),
    staleTime: STALE_TIMES.nextUp,
  });
}

export function useRecentlyAdded(): UseQueryResult<MediaItem[]> {
  const ctx = useHomeContext();
  return useQuery({
    queryKey: queryKeys.recentlyAdded(ctx.userId ?? ""),
    queryFn: ({ signal }) => {
      if (!canFetch(ctx)) {
        throw new Error("useRecentlyAdded called without auth context");
      }
      return fetchRecentlyAdded(
        { baseUrl: ctx.serverUrl, userId: ctx.userId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: canFetch(ctx),
    staleTime: STALE_TIMES.recentlyAdded,
  });
}

export function useLatestMovies(): UseQueryResult<MediaItem[]> {
  const ctx = useHomeContext();
  return useQuery({
    queryKey: queryKeys.latestMovies(ctx.userId ?? ""),
    queryFn: ({ signal }) => {
      if (!canFetch(ctx)) {
        throw new Error("useLatestMovies called without auth context");
      }
      return fetchLatestMovies(
        { baseUrl: ctx.serverUrl, userId: ctx.userId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: canFetch(ctx),
    staleTime: STALE_TIMES.latestMovies,
  });
}

export function useLatestTv(): UseQueryResult<MediaItem[]> {
  const ctx = useHomeContext();
  return useQuery({
    queryKey: queryKeys.latestTv(ctx.userId ?? ""),
    queryFn: ({ signal }) => {
      if (!canFetch(ctx)) {
        throw new Error("useLatestTv called without auth context");
      }
      return fetchLatestTv(
        { baseUrl: ctx.serverUrl, userId: ctx.userId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: canFetch(ctx),
    staleTime: STALE_TIMES.latestTv,
  });
}
