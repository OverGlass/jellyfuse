import {
  createJellyseerrRequest,
  type CreateRequestArgs,
  fetchQualityProfiles,
  fetchTmdbTvSeasons,
  type JellyseerrServiceType,
} from "@jellyfuse/api";
import type { MediaServer, SeasonInfo } from "@jellyfuse/models";
import { queryKeys, STALE_TIMES } from "@jellyfuse/query-keys";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/services/auth/state";
import { jellyseerrFetch } from "@/services/jellyseerr/client";

/**
 * Hooks behind the request flow modal.
 *
 * - `useQualityProfiles(service)` — list of Radarr / Sonarr servers
 *   + their available quality profiles. Long stale time (30 min) so
 *   the modal opens instantly on subsequent opens.
 * - `useTmdbTvSeasons(tmdbId)` — per-season availability for a TV
 *   show (`available` / `requested` / `missing`), used by the season
 *   picker to disable already-served seasons.
 * - `useCreateRequestMutation()` — POST `/api/v1/request`. On success
 *   we invalidate the requests + tmdb-tv-seasons queries so the
 *   newly-requested seasons immediately show up in the modal next
 *   time it's opened, and the requests tab refreshes the next time
 *   it's visited.
 *
 * All three are gated on `jellyseerrStatus === "connected"`. When
 * Jellyseerr isn't configured / the user has no session cookie, the
 * queries are disabled and the mutation throws a clear error before
 * touching the network.
 */

export function useQualityProfiles(service: JellyseerrServiceType): UseQueryResult<MediaServer[]> {
  const { jellyseerrUrl, jellyseerrStatus } = useAuth();
  const enabled = jellyseerrStatus === "connected" && jellyseerrUrl !== undefined;
  return useQuery({
    queryKey: queryKeys.qualityProfiles(service),
    queryFn: ({ signal }) => {
      if (!jellyseerrUrl) {
        throw new Error("useQualityProfiles called without jellyseerrUrl");
      }
      return fetchQualityProfiles({ baseUrl: jellyseerrUrl, service }, jellyseerrFetch, signal);
    },
    enabled,
    staleTime: STALE_TIMES.qualityProfiles,
    retry: 0,
  });
}

export function useTmdbTvSeasons(tmdbId: number | undefined): UseQueryResult<SeasonInfo[]> {
  const { jellyseerrUrl, jellyseerrStatus } = useAuth();
  const enabled =
    tmdbId !== undefined && jellyseerrStatus === "connected" && jellyseerrUrl !== undefined;
  return useQuery({
    queryKey: queryKeys.tmdbTvSeasons(tmdbId ?? 0),
    queryFn: ({ signal }) => {
      if (!jellyseerrUrl || tmdbId === undefined) {
        throw new Error("useTmdbTvSeasons called without auth context");
      }
      return fetchTmdbTvSeasons({ baseUrl: jellyseerrUrl, tmdbId }, jellyseerrFetch, signal);
    },
    enabled,
    staleTime: STALE_TIMES.tmdbTvSeasons,
    retry: 0,
  });
}

/**
 * Mutation hook for `createJellyseerrRequest`. Doesn't bother with
 * optimistic updates: we just invalidate `tmdbTvSeasons` (so the
 * modal sees the new pending state if reopened) and the future
 * `requests` query (Phase 4d) once it lands. Mirrors the Rust flow,
 * which also issues a fresh `GET /requests` after the POST instead
 * of patching local state.
 */
export function useCreateRequestMutation() {
  const queryClient = useQueryClient();
  const { jellyseerrUrl, jellyseerrStatus } = useAuth();
  return useMutation({
    mutationFn: (input: Omit<CreateRequestArgs, "baseUrl">) => {
      if (jellyseerrStatus !== "connected" || !jellyseerrUrl) {
        throw new Error("Jellyseerr is not connected — sign in to request media.");
      }
      return createJellyseerrRequest({ ...input, baseUrl: jellyseerrUrl }, jellyseerrFetch);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tmdbTvSeasons(variables.tmdbId) });
      // Phase 4d will own a `requests` query — invalidate it eagerly
      // so the requests tab refreshes the next time it mounts.
      queryClient.invalidateQueries({ queryKey: ["home"], exact: false });
    },
  });
}
