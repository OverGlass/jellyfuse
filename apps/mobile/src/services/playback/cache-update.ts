// Optimistic local cache patch run after every stop-playback report
// (immediate path + drainer replay). Mirrors Jellyfin's open-source
// server rules so the cache matches what `/Users/{uid}/Items/Resume`,
// `/Shows/NextUp`, and per-item `UserData` would return after the stop
// report lands. Lets the UI reflect new resume position / played state
// instantly, including offline; on a successful HTTP ack the reporter
// follows up with `invalidateQueries` to converge on server truth.
//
// Jellyfin rules (verified against jellyfin/jellyfin master):
//
// - `Played = true` when `pct >= MaxResumePct` (default 90 %) —
//   `MediaBrowser.Model/Configuration/ServerConfiguration.cs`.
//   On crossing: `PlaybackPositionTicks -> 0`, `PlayCount++`,
//   `LastPlayedDate = now`.
// - Below threshold: `PlaybackPositionTicks = body.PositionTicks`,
//   `LastPlayedDate = now`, no PlayCount change.
// - `/Items/Resume` membership: `played === false` AND `pos > 0` AND
//   `MinResumePct <= pct < MaxResumePct` (defaults 5 % / 90 %) AND
//   `runtimeSeconds >= MinResumeDurationSeconds` (default 300 s).
// - `/Items/Resume` order: `LastPlayedDate DESC`.
// - `/Shows/NextUp`: per series, first unwatched episode in series
//   order. We can only locally swap when `seasonEpisodes` is hydrated;
//   otherwise we just drop the played episode and let the next refetch
//   re-derive.

import type { MediaItem, UserItemData } from "@jellyfuse/models";
import { mediaIdJellyfin, ticksToSeconds } from "@jellyfuse/models";
import { queryKeys } from "@jellyfuse/query-keys";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

/**
 * Jellyfin server-config thresholds that aren't exposed to non-admin
 * clients. Defaults sourced from
 * `MediaBrowser.Model/Configuration/ServerConfiguration.cs`. If an
 * admin overrides them server-side the local prediction can briefly
 * disagree with the server; the post-success invalidation refetch
 * (see `reporter.ts`) reconciles silently.
 */
export const RESUME_CONFIG = {
  maxResumePct: 0.9,
  minResumePct: 0.05,
  minResumeDurationSeconds: 300,
} as const;

interface ApplyStopReportArgs {
  jellyfinId: string;
  positionTicks: number;
  /** From `resolved.durationSeconds`. `0` when unknown (degraded mode). */
  runtimeTicks: number;
  userId: string;
  /** ISO timestamp; injected so tests can pin time. */
  nowIso: string;
}

interface ShelfPageLike {
  items: MediaItem[];
  totalRecordCount: number;
  nextStartIndex: number | undefined;
}

/**
 * Walk every `MediaItem`-bearing cache for `userId` and apply the
 * updated `userData` + derived `progress`. For `continueWatching` the
 * function additionally recomputes membership and ordering per the
 * resume rules above. For `nextUp` it best-effort swaps in the next
 * episode using `seasonEpisodes` cache, falling back to removal.
 *
 * Idempotent: every patch is computed from the current cached value.
 * Safe to call after both an online success and an offline-queued
 * failure — the optimistic state should persist across drainer
 * retries.
 */
export function applyStopReportLocally(queryClient: QueryClient, args: ApplyStopReportArgs): void {
  const { jellyfinId, positionTicks, runtimeTicks, userId, nowIso } = args;

  const wasResumable = runtimeTicks > 0;
  const playedPct = wasResumable ? positionTicks / runtimeTicks : 0;
  const willBePlayed = wasResumable && playedPct >= RESUME_CONFIG.maxResumePct;
  const runtimeSeconds = ticksToSeconds(runtimeTicks);
  const meetsDuration = runtimeSeconds >= RESUME_CONFIG.minResumeDurationSeconds;
  const meetsMinPct = playedPct >= RESUME_CONFIG.minResumePct;
  const meetsMaxPct = playedPct < RESUME_CONFIG.maxResumePct;
  const belongsInResume =
    wasResumable && !willBePlayed && meetsDuration && meetsMinPct && meetsMaxPct;

  const buildUserData = (prev: UserItemData | undefined): UserItemData => {
    const base: UserItemData = prev ?? {
      played: false,
      playCount: 0,
      playbackPositionTicks: 0,
      isFavorite: false,
      lastPlayedDate: undefined,
    };

    // Without a runtime we can't decide the played threshold. Patch
    // position + lastPlayedDate; leave `played` and `playCount` alone.
    if (!wasResumable) {
      return { ...base, playbackPositionTicks: positionTicks, lastPlayedDate: nowIso };
    }

    if (willBePlayed) {
      const wasAlreadyPlayed = base.played;
      return {
        played: true,
        // Jellyfin resets the resume point when crossing the played
        // threshold (`SessionManager.OnPlaybackStopped`).
        playbackPositionTicks: 0,
        playCount: wasAlreadyPlayed ? base.playCount : base.playCount + 1,
        isFavorite: base.isFavorite,
        lastPlayedDate: nowIso,
      };
    }

    return {
      played: base.played,
      playbackPositionTicks: positionTicks,
      playCount: base.playCount,
      isFavorite: base.isFavorite,
      lastPlayedDate: nowIso,
    };
  };

  const buildProgress = (prev: number | undefined): number | undefined => {
    if (!wasResumable) return prev;
    if (willBePlayed) return 1;
    return clamp01(playedPct);
  };

  const matches = (item: MediaItem) => mediaIdJellyfin(item.id) === jellyfinId;

  const patchItem = (item: MediaItem): MediaItem => ({
    ...item,
    userData: buildUserData(item.userData),
    progress: buildProgress(item.progress),
  });

  patchSimpleListCaches(queryClient, userId, matches, patchItem);
  patchContinueWatching(queryClient, userId, jellyfinId, matches, patchItem, belongsInResume);
  patchNextUp(queryClient, userId, jellyfinId, matches, patchItem, willBePlayed);
  patchDetailCaches(queryClient, userId, jellyfinId, patchItem);
  patchSeasonEpisodes(queryClient, userId, matches, patchItem);
  patchShelfInfinite(queryClient, matches, patchItem);
  patchSearchJellyfin(queryClient, matches, patchItem);
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-cache patchers
// ──────────────────────────────────────────────────────────────────────────────

function patchSimpleListCaches(
  queryClient: QueryClient,
  userId: string,
  matches: (item: MediaItem) => boolean,
  patchItem: (item: MediaItem) => MediaItem,
): void {
  const keys = [
    queryKeys.recentlyAdded(userId),
    queryKeys.latestMovies(userId),
    queryKeys.latestTv(userId),
  ];
  for (const key of keys) {
    queryClient.setQueryData<MediaItem[]>(key, (prev) =>
      prev ? prev.map((it) => (matches(it) ? patchItem(it) : it)) : prev,
    );
  }
}

function patchContinueWatching(
  queryClient: QueryClient,
  userId: string,
  jellyfinId: string,
  matches: (item: MediaItem) => boolean,
  patchItem: (item: MediaItem) => MediaItem,
  belongsInResume: boolean,
): void {
  const key = queryKeys.continueWatching(userId);
  queryClient.setQueryData<MediaItem[]>(key, (prev) => {
    const existing = prev ?? [];
    const idx = existing.findIndex(matches);

    if (idx >= 0) {
      const without = existing.slice();
      const [current] = without.splice(idx, 1);
      if (!belongsInResume) return without;
      // Patch + move to top — Jellyfin's `/Items/Resume` is sorted by
      // `LastPlayedDate DESC`, and our patch sets `lastPlayedDate = now`,
      // so the just-watched item always becomes the head.
      return current ? [patchItem(current), ...without] : without;
    }

    // Item not currently in continueWatching. If it now qualifies and
    // we have a canonical MediaItem somewhere else in the cache, insert
    // at the top. If no copy is hydrated, skip silently — staleTime
    // refetch (or post-success invalidation) will pull it in.
    if (!belongsInResume) return existing;
    const canonical = findCanonicalMediaItem(queryClient, userId, jellyfinId);
    if (!canonical) return existing;
    return [patchItem(canonical), ...existing];
  });
}

function patchNextUp(
  queryClient: QueryClient,
  userId: string,
  jellyfinId: string,
  matches: (item: MediaItem) => boolean,
  patchItem: (item: MediaItem) => MediaItem,
  willBePlayed: boolean,
): void {
  const key = queryKeys.nextUp(userId);
  queryClient.setQueryData<MediaItem[]>(key, (prev) => {
    if (!prev) return prev;
    const idx = prev.findIndex(matches);
    if (idx < 0) return prev;

    const played = prev[idx];
    if (!played) return prev;

    if (!willBePlayed) {
      // Episode was watched part-way; userData updates but it stays
      // as the "next" until it crosses the played threshold.
      return prev.map((it) => (matches(it) ? patchItem(it) : it));
    }

    const next = findNextEpisode(queryClient, userId, played);
    if (next) {
      return prev.map((it, i) => (i === idx ? next : it));
    }
    return prev.filter((_, i) => i !== idx);
  });
}

function patchDetailCaches(
  queryClient: QueryClient,
  userId: string,
  jellyfinId: string,
  patchItem: (item: MediaItem) => MediaItem,
): void {
  const keys = [
    queryKeys.movieDetail(userId, jellyfinId),
    queryKeys.seriesDetail(userId, jellyfinId),
  ];
  for (const key of keys) {
    queryClient.setQueryData<MediaItem>(key, (prev) => (prev ? patchItem(prev) : prev));
  }
}

function patchSeasonEpisodes(
  queryClient: QueryClient,
  userId: string,
  matches: (item: MediaItem) => boolean,
  patchItem: (item: MediaItem) => MediaItem,
): void {
  const queries = queryClient.getQueriesData<MediaItem[]>({
    predicate: (q) => isSeasonEpisodesKey(q.queryKey, userId),
  });
  for (const [key, data] of queries) {
    if (!data) continue;
    queryClient.setQueryData<MediaItem[]>(key, (prev) =>
      prev ? prev.map((it) => (matches(it) ? patchItem(it) : it)) : prev,
    );
  }
}

function patchShelfInfinite(
  queryClient: QueryClient,
  matches: (item: MediaItem) => boolean,
  patchItem: (item: MediaItem) => MediaItem,
): void {
  const queries = queryClient.getQueriesData<InfiniteData<ShelfPageLike, number>>({
    predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "shelf",
  });
  for (const [key, data] of queries) {
    if (!data) continue;
    queryClient.setQueryData<InfiniteData<ShelfPageLike, number>>(key, (prev) =>
      prev
        ? {
            ...prev,
            pages: prev.pages.map((page) => ({
              ...page,
              items: page.items.map((it) => (matches(it) ? patchItem(it) : it)),
            })),
          }
        : prev,
    );
  }
}

function patchSearchJellyfin(
  queryClient: QueryClient,
  matches: (item: MediaItem) => boolean,
  patchItem: (item: MediaItem) => MediaItem,
): void {
  // The blended search hook splits the cache into a Jellyfin-side and a
  // Jellyseerr-side query. Only the Jellyfin side carries `MediaItem[]`
  // with userData; the Jellyseerr side is request-shaped. The key shape
  // is `["search", userId, query, "jellyfin", includeTypes]`.
  const queries = queryClient.getQueriesData<MediaItem[]>({
    predicate: (q) =>
      Array.isArray(q.queryKey) && q.queryKey[0] === "search" && q.queryKey[3] === "jellyfin",
  });
  for (const [key, data] of queries) {
    if (!data) continue;
    queryClient.setQueryData<MediaItem[]>(key, (prev) =>
      prev ? prev.map((it) => (matches(it) ? patchItem(it) : it)) : prev,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function findCanonicalMediaItem(
  queryClient: QueryClient,
  userId: string,
  jellyfinId: string,
): MediaItem | undefined {
  const detail =
    queryClient.getQueryData<MediaItem>(queryKeys.movieDetail(userId, jellyfinId)) ??
    queryClient.getQueryData<MediaItem>(queryKeys.seriesDetail(userId, jellyfinId));
  if (detail) return detail;

  const listKeys = [
    queryKeys.continueWatching(userId),
    queryKeys.nextUp(userId),
    queryKeys.recentlyAdded(userId),
    queryKeys.latestMovies(userId),
    queryKeys.latestTv(userId),
  ];
  for (const key of listKeys) {
    const list = queryClient.getQueryData<MediaItem[]>(key);
    const found = list?.find((it) => mediaIdJellyfin(it.id) === jellyfinId);
    if (found) return found;
  }

  const seasonQueries = queryClient.getQueriesData<MediaItem[]>({
    predicate: (q) => isSeasonEpisodesKey(q.queryKey, userId),
  });
  for (const [, data] of seasonQueries) {
    const found = data?.find((it) => mediaIdJellyfin(it.id) === jellyfinId);
    if (found) return found;
  }

  return undefined;
}

function findNextEpisode(
  queryClient: QueryClient,
  userId: string,
  played: MediaItem,
): MediaItem | undefined {
  const seriesId = played.seriesId;
  const seasonNumber = played.seasonNumber;
  const episodeNumber = played.episodeNumber;
  if (!seriesId || seasonNumber === undefined || episodeNumber === undefined) return undefined;

  const seasonQueries = queryClient.getQueriesData<MediaItem[]>({
    predicate: (q) => isSeasonEpisodesKey(q.queryKey, userId),
  });

  // Same-season +1 first, then first episode of the next season.
  for (const [, data] of seasonQueries) {
    if (!data) continue;
    const sameSeasonNext = data.find(
      (it) =>
        it.seriesId === seriesId &&
        it.seasonNumber === seasonNumber &&
        it.episodeNumber === episodeNumber + 1 &&
        !it.userData?.played,
    );
    if (sameSeasonNext) return sameSeasonNext;
  }
  for (const [, data] of seasonQueries) {
    if (!data) continue;
    const nextSeasonFirst = data
      .filter(
        (it) =>
          it.seriesId === seriesId && it.seasonNumber === seasonNumber + 1 && !it.userData?.played,
      )
      .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))[0];
    if (nextSeasonFirst) return nextSeasonFirst;
  }
  return undefined;
}

function isSeasonEpisodesKey(key: readonly unknown[], userId: string): boolean {
  return (
    Array.isArray(key) && key[0] === "detail" && key[1] === userId && key[2] === "season-episodes"
  );
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
