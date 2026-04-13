import {
  blendSearchResults,
  type BlendedSearchTypeFilter,
  fetchJellyfinSearch,
  fetchJellyseerrSearch,
  type JellyfinSearchItemType,
} from "@jellyfuse/api";
import type { BlendedSearchResults } from "@jellyfuse/models";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import { useQueries } from "@tanstack/react-query";
import { apiFetch, apiFetchAuthenticated } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";

/**
 * Blended Jellyfin + Jellyseerr search. Fans the two sources out
 * through `useQueries` so they run in parallel, then folds the result
 * into the domain `BlendedSearchResults` via `blendSearchResults`
 * (pure fn in `@jellyfuse/api`).
 *
 * Rules:
 * - Disabled until the query string reaches `MIN_QUERY_LENGTH`.
 * - Jellyseerr side is skipped entirely when Jellyseerr is not
 *   configured or the active user has no session cookie — the blend
 *   then degrades to library-only without surfacing an error.
 * - A failed Jellyseerr call does NOT fail the whole hook: we keep
 *   whatever Jellyfin returned and expose the Jellyseerr error
 *   separately via `jellyseerrError` so the UI can show a banner.
 * - `isFetching` / `isLoading` aggregate the two sides; `data` is
 *   recomputed only when both sides have settled to avoid flashing a
 *   stale blend while one side refetches.
 *
 * React Compiler handles memoisation — no manual `useMemo`.
 */

const MIN_QUERY_LENGTH = 2;

export interface UseSearchBlendedResult {
  /** `null` until at least one source has produced its first result. */
  data: BlendedSearchResults | null;
  isLoading: boolean;
  isFetching: boolean;
  /** Jellyfin HTTP / parse error — propagates up as the hook's error. */
  error: unknown;
  /** Jellyseerr-side error, surfaced separately so the UI can show a banner. */
  jellyseerrError: unknown;
}

/**
 * Optional shape for type-filtered shelf-grid search variants.
 * - `includeTypes` constrains the Jellyfin server-side search.
 * - `typeFilter` is applied to the blend on both sides post-fetch.
 *   The two are kept separate because Jellyseerr's server response
 *   doesn't accept a type param, so we filter its results in JS.
 */
export interface UseSearchBlendedOptions {
  includeTypes?: JellyfinSearchItemType;
  typeFilter?: BlendedSearchTypeFilter;
}

export function useSearchBlended(
  query: string,
  options: UseSearchBlendedOptions = {},
): UseSearchBlendedResult {
  const { serverUrl, activeUser, jellyseerrUrl, jellyseerrStatus } = useAuth();
  const userId = activeUser?.userId;
  const trimmedQuery = query.trim();
  const hasMinQuery = trimmedQuery.length >= MIN_QUERY_LENGTH;
  const jellyfinEnabled = hasMinQuery && Boolean(serverUrl && userId);
  const jellyseerrEnabled =
    hasMinQuery &&
    jellyseerrStatus === "connected" &&
    jellyseerrUrl !== undefined &&
    Boolean(activeUser?.jellyseerrCookie);
  const includeTypes = options.includeTypes;
  const typeFilter = options.typeFilter;

  return useQueries({
    queries: [
      {
        queryKey: [
          ...queryKeys.search(userId ?? "", trimmedQuery),
          "jellyfin",
          includeTypes ?? "all",
        ] as const,
        queryFn: ({ signal }: { signal?: AbortSignal }) => {
          if (!serverUrl || !userId) {
            throw new Error("useSearchBlended jellyfin side called without auth context");
          }
          return fetchJellyfinSearch(
            {
              baseUrl: serverUrl,
              userId,
              query: trimmedQuery,
              ...(includeTypes !== undefined ? { includeTypes } : {}),
            },
            apiFetchAuthenticated,
            signal,
          );
        },
        enabled: jellyfinEnabled,
        staleTime: STALE_TIMES.search,
      },
      {
        queryKey: [...queryKeys.search(userId ?? "", trimmedQuery), "jellyseerr"] as const,
        queryFn: ({ signal }: { signal?: AbortSignal }) => {
          if (!jellyseerrUrl) {
            throw new Error("useSearchBlended jellyseerr side called without jellyseerrUrl");
          }
          return fetchJellyseerrSearch(
            { baseUrl: jellyseerrUrl, query: trimmedQuery },
            apiFetch,
            signal,
          );
        },
        enabled: jellyseerrEnabled,
        staleTime: STALE_TIMES.search,
        retry: 0,
      },
    ],
    combine: (results): UseSearchBlendedResult => {
      const [jellyfinResult, jellyseerrResult] = results;
      const jellyfinData = jellyfinResult?.data;
      const jellyseerrData = jellyseerrEnabled ? jellyseerrResult?.data : [];
      const hasJellyfin = jellyfinData !== undefined;
      const hasJellyseerr = jellyseerrEnabled ? jellyseerrData !== undefined : true;
      const data: BlendedSearchResults | null =
        hasJellyfin && hasJellyseerr
          ? blendSearchResults(jellyfinData ?? [], jellyseerrData ?? [], typeFilter)
          : null;
      return {
        data,
        isLoading:
          (jellyfinEnabled && (jellyfinResult?.isLoading ?? false)) ||
          (jellyseerrEnabled && (jellyseerrResult?.isLoading ?? false)),
        isFetching:
          (jellyfinResult?.isFetching ?? false) || (jellyseerrResult?.isFetching ?? false),
        error: jellyfinResult?.error ?? null,
        jellyseerrError: jellyseerrResult?.error ?? null,
      };
    },
  });
}
