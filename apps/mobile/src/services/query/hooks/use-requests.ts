import { fetchJellyseerrDownloadProgress, fetchJellyseerrRequests } from "@jellyfuse/api";
import type { DownloadProgress, MediaRequest } from "@jellyfuse/models";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/services/auth/state";
import { jellyseerrFetch } from "@/services/jellyseerr/client";

/**
 * Hooks for the Jellyseerr requests tab.
 *
 * - `useJellyseerrRequests()` fetches the user's requests list via
 *   `GET /api/v1/request`. Refetch cadence: 120s stale + a 15s
 *   `refetchInterval` while the tab is mounted so newly-approved /
 *   available states show up without a manual pull-to-refresh.
 *   Mirrors the Rust `download_polling_loop` cadence.
 *
 * - `useDownloadProgressMap(requests)` takes the loaded requests
 *   array and fans `fetchJellyseerrDownloadProgress` out across all
 *   the TMDB ids via `useQueries`. Each per-item query polls every
 *   10s (`STALE_TIMES.downloadProgress`) so the progress bar ticks
 *   smoothly. The hook's return value is a `Map<tmdbId, DownloadProgress>`
 *   the row component reads by TMDB id — items that haven't started
 *   downloading yet are absent from the map.
 *
 * Both hooks short-circuit to disabled when Jellyseerr isn't
 * connected. `useAuth()` feeds the gate so a user with no session
 * cookie doesn't fire bogus HTTP calls on mount.
 */

const REQUESTS_REFETCH_MS = 15_000;

export function useJellyseerrRequests(): UseQueryResult<MediaRequest[]> {
  const { jellyseerrUrl, jellyseerrStatus, activeUser } = useAuth();
  // userId is used only to scope the cache key per user (invalidated on switch),
  // not passed to the endpoint — Jellyseerr scopes via the session cookie.
  const userId = activeUser?.userId ?? "";
  const enabled = jellyseerrStatus === "connected" && jellyseerrUrl !== undefined;
  return useQuery({
    queryKey: queryKeys.jellyseerrRequests(userId),
    queryFn: ({ signal }) => {
      if (!jellyseerrUrl) throw new Error("useJellyseerrRequests called without jellyseerrUrl");
      return fetchJellyseerrRequests({ baseUrl: jellyseerrUrl }, jellyseerrFetch, signal);
    },
    enabled,
    staleTime: STALE_TIMES.requests,
    refetchInterval: enabled ? REQUESTS_REFETCH_MS : false,
    retry: 0,
  });
}

export interface UseDownloadProgressMapResult {
  /** Keyed by TMDB id. Items with no queue entry are absent. */
  map: Map<number, DownloadProgress>;
  isFetching: boolean;
}

export function useDownloadProgressMap(
  requests: MediaRequest[] | undefined,
): UseDownloadProgressMapResult {
  const { jellyseerrUrl, jellyseerrStatus } = useAuth();
  const enabled = jellyseerrStatus === "connected" && jellyseerrUrl !== undefined;

  // Only poll entries that are actively being filled — pending and
  // declined requests never have a download queue entry, and already-
  // available items don't need updates. Matches Rust's filter in
  // `fetch_download_progress_for_requests`.
  const pollable = (requests ?? []).filter(
    (r) => r.status === "approved" || r.status === "pending",
  );

  const results = useQueries({
    queries: pollable.map((request) => ({
      queryKey: ["download-progress", request.tmdbId, request.mediaType] as const,
      queryFn: ({ signal }: { signal?: AbortSignal }) => {
        if (!jellyseerrUrl) {
          throw new Error("useDownloadProgressMap queried without jellyseerrUrl");
        }
        return fetchJellyseerrDownloadProgress(
          {
            baseUrl: jellyseerrUrl,
            tmdbId: request.tmdbId,
            mediaType: request.mediaType,
          },
          jellyseerrFetch,
          signal,
        );
      },
      enabled,
      staleTime: STALE_TIMES.downloadProgress,
      refetchInterval: enabled ? STALE_TIMES.downloadProgress : false,
      retry: 0,
    })),
  });

  const map = new Map<number, DownloadProgress>();
  for (let i = 0; i < pollable.length; i++) {
    const request = pollable[i];
    const result = results[i];
    if (request && result?.data) {
      map.set(request.tmdbId, result.data);
    }
  }
  const isFetching = results.some((r) => r.isFetching);
  return { map, isFetching };
}
