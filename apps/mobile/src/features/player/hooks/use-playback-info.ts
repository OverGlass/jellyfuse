// React Query hooks for playback data. Follows the same pattern as
// useMovieDetail — pure query, no side effects.

import {
  fetchIntroSkipperSegments,
  fetchPlaybackInfo,
  fetchTrickplayInfo,
  type TrickplayData,
} from "@jellyfuse/api";
import type { IntroSkipperSegments, PlaybackInfo } from "@jellyfuse/models";
import { queryKeys } from "@jellyfuse/query-keys";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetchAuthenticated } from "@/services/api/client";
import { useAuth } from "@/services/auth/state";

/**
 * Fetches PlaybackInfo for an item via React Query. NOT persisted
 * (excluded in should-dehydrate.ts) since playback info is volatile.
 */
export function usePlaybackInfo(jellyfinId: string | undefined): UseQueryResult<PlaybackInfo> {
  const { serverUrl, activeUser } = useAuth();
  const userId = activeUser?.userId;
  const token = activeUser?.token;

  return useQuery({
    queryKey: queryKeys.playbackInfo(userId ?? "", jellyfinId ?? ""),
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
    staleTime: 0,
    gcTime: 60_000,
    retry: 1,
  });
}

/**
 * Fetches intro-skipper segments (intro/recap/credits) from the
 * Jellyfin plugin. Returns undefined if the plugin isn't installed
 * or the item has no segments. Never errors — silently returns undefined.
 */
export function useIntroSkipperSegments(
  jellyfinId: string | undefined,
): UseQueryResult<IntroSkipperSegments | undefined> {
  const { serverUrl } = useAuth();

  return useQuery({
    queryKey: queryKeys.introSkipper(jellyfinId ?? ""),
    queryFn: ({ signal }) => {
      if (!serverUrl || !jellyfinId) return undefined;
      return fetchIntroSkipperSegments(
        { baseUrl: serverUrl, itemId: jellyfinId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: Boolean(serverUrl && jellyfinId),
    staleTime: 0,
    gcTime: 60_000,
    retry: 0,
  });
}

/**
 * Fetches trickplay metadata (tile dimensions, interval, sheet URLs).
 * Returns undefined if trickplay is not generated for this item.
 */
export function useTrickplayInfo(
  jellyfinId: string | undefined,
): UseQueryResult<TrickplayData | undefined> {
  const { serverUrl } = useAuth();

  return useQuery({
    queryKey: queryKeys.trickplayInfo(jellyfinId ?? ""),
    queryFn: ({ signal }) => {
      if (!serverUrl || !jellyfinId) return undefined;
      return fetchTrickplayInfo(
        { baseUrl: serverUrl, itemId: jellyfinId },
        apiFetchAuthenticated,
        signal,
      );
    },
    enabled: Boolean(serverUrl && jellyfinId),
    staleTime: 5 * 60 * 1000, // Trickplay data is static per item
    gcTime: 60_000,
    retry: 0,
  });
}
