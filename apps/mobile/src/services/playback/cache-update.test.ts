import type { MediaItem, UserItemData } from "@jellyfuse/models";
import { secondsToTicks } from "@jellyfuse/models";
import { queryKeys } from "@jellyfuse/query-keys";
import type { InfiniteData } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { applyStopReportLocally, RESUME_CONFIG } from "./cache-update";

const USER_ID = "user-1";
const NOW = "2026-04-25T12:00:00.000Z";

let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

// ──────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeMovie(overrides: Partial<MediaItem> = {}): MediaItem {
  const id: MediaItem["id"] = {
    kind: "jellyfin",
    jellyfinId:
      overrides.id && "jellyfinId" in overrides.id
        ? (overrides.id as { jellyfinId: string }).jellyfinId
        : "jf-movie",
  };
  return {
    id,
    source: "jellyfin",
    availability: { kind: "available" },
    mediaType: "movie",
    title: "Test Movie",
    sortTitle: undefined,
    year: 2020,
    overview: undefined,
    posterUrl: undefined,
    backdropUrl: undefined,
    logoUrl: undefined,
    genres: [],
    rating: undefined,
    progress: undefined,
    runtimeMinutes: 120,
    userData: undefined,
    seasonCount: undefined,
    episodeCount: undefined,
    seriesName: undefined,
    seasonNumber: undefined,
    episodeNumber: undefined,
    seriesId: undefined,
    ...overrides,
  };
}

function makeEpisode(overrides: Partial<MediaItem> = {}): MediaItem {
  return makeMovie({
    mediaType: "episode",
    seriesName: "Test Series",
    seriesId: "jf-series-1",
    seasonNumber: 1,
    episodeNumber: 1,
    ...overrides,
  });
}

const HOUR_TICKS = secondsToTicks(60 * 60);
const TWO_HOUR_TICKS = secondsToTicks(120 * 60);

// ──────────────────────────────────────────────────────────────────────────────
// continueWatching membership + ordering
// ──────────────────────────────────────────────────────────────────────────────

describe("applyStopReportLocally — continueWatching", () => {
  it("inserts a movie at the top when it newly qualifies for resume", () => {
    const otherA = makeMovie({ id: { kind: "jellyfin", jellyfinId: "other-a" } });
    const otherB = makeMovie({ id: { kind: "jellyfin", jellyfinId: "other-b" } });
    qc.setQueryData(queryKeys.continueWatching(USER_ID), [otherA, otherB]);

    // Hydrate a canonical copy of the played movie via detail cache.
    const played = makeMovie({ id: { kind: "jellyfin", jellyfinId: "jf-played" } });
    qc.setQueryData(queryKeys.movieDetail(USER_ID, "jf-played"), played);

    applyStopReportLocally(qc, {
      jellyfinId: "jf-played",
      positionTicks: secondsToTicks(60 * 30), // 30 min of 2h = 25%
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    const list = qc.getQueryData<MediaItem[]>(queryKeys.continueWatching(USER_ID));
    expect(list).toHaveLength(3);
    expect(list?.[0]?.id).toEqual({ kind: "jellyfin", jellyfinId: "jf-played" });
    expect(list?.[0]?.userData?.playbackPositionTicks).toBe(secondsToTicks(60 * 30));
    expect(list?.[0]?.progress).toBeCloseTo(0.25);
  });

  it("removes the item from continueWatching when it crosses the played threshold", () => {
    const played = makeMovie({
      id: { kind: "jellyfin", jellyfinId: "jf-played" },
      userData: {
        played: false,
        playCount: 0,
        playbackPositionTicks: secondsToTicks(60 * 30),
        isFavorite: false,
        lastPlayedDate: undefined,
      },
    });
    qc.setQueryData(queryKeys.continueWatching(USER_ID), [played]);

    applyStopReportLocally(qc, {
      jellyfinId: "jf-played",
      positionTicks: secondsToTicks(60 * 115), // 115 min of 120 ≈ 95.8 %
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    expect(qc.getQueryData<MediaItem[]>(queryKeys.continueWatching(USER_ID))).toEqual([]);
  });

  it("moves an existing entry to the top with updated position", () => {
    const a = makeMovie({ id: { kind: "jellyfin", jellyfinId: "a" } });
    const target = makeMovie({
      id: { kind: "jellyfin", jellyfinId: "target" },
      userData: {
        played: false,
        playCount: 0,
        playbackPositionTicks: secondsToTicks(60 * 10),
        isFavorite: false,
        lastPlayedDate: undefined,
      },
    });
    const c = makeMovie({ id: { kind: "jellyfin", jellyfinId: "c" } });
    qc.setQueryData(queryKeys.continueWatching(USER_ID), [a, target, c]);

    applyStopReportLocally(qc, {
      jellyfinId: "target",
      positionTicks: secondsToTicks(60 * 60), // 60 / 120 = 50 %
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    const list = qc.getQueryData<MediaItem[]>(queryKeys.continueWatching(USER_ID));
    expect(list?.map((it) => (it.id as { jellyfinId: string }).jellyfinId)).toEqual([
      "target",
      "a",
      "c",
    ]);
    expect(list?.[0]?.userData?.lastPlayedDate).toBe(NOW);
    expect(list?.[0]?.userData?.playbackPositionTicks).toBe(secondsToTicks(60 * 60));
  });

  it("does not insert into continueWatching below MinResumePct", () => {
    const a = makeMovie({ id: { kind: "jellyfin", jellyfinId: "a" } });
    qc.setQueryData(queryKeys.continueWatching(USER_ID), [a]);
    qc.setQueryData(
      queryKeys.movieDetail(USER_ID, "fresh"),
      makeMovie({ id: { kind: "jellyfin", jellyfinId: "fresh" } }),
    );

    applyStopReportLocally(qc, {
      jellyfinId: "fresh",
      positionTicks: secondsToTicks(60), // 1 min of 120 ≈ 0.83 % — below 5 %
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    expect(qc.getQueryData<MediaItem[]>(queryKeys.continueWatching(USER_ID))).toHaveLength(1);
  });

  it("does not insert when runtime is below MinResumeDurationSeconds", () => {
    const a = makeMovie({ id: { kind: "jellyfin", jellyfinId: "a" } });
    qc.setQueryData(queryKeys.continueWatching(USER_ID), [a]);
    qc.setQueryData(
      queryKeys.movieDetail(USER_ID, "short"),
      makeMovie({ id: { kind: "jellyfin", jellyfinId: "short" } }),
    );

    const shortRuntime = secondsToTicks(RESUME_CONFIG.minResumeDurationSeconds - 1);
    applyStopReportLocally(qc, {
      jellyfinId: "short",
      positionTicks: Math.floor(shortRuntime * 0.5),
      runtimeTicks: shortRuntime,
      userId: USER_ID,
      nowIso: NOW,
    });

    expect(qc.getQueryData<MediaItem[]>(queryKeys.continueWatching(USER_ID))).toHaveLength(1);
  });

  it("skips silent when no canonical MediaItem is hydrated anywhere", () => {
    qc.setQueryData(queryKeys.continueWatching(USER_ID), []);

    applyStopReportLocally(qc, {
      jellyfinId: "ghost",
      positionTicks: secondsToTicks(60 * 30),
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    expect(qc.getQueryData<MediaItem[]>(queryKeys.continueWatching(USER_ID))).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// nextUp swap / remove
// ──────────────────────────────────────────────────────────────────────────────

describe("applyStopReportLocally — nextUp", () => {
  it("swaps the played episode for the next unwatched one in the same season", () => {
    const ep1 = makeEpisode({
      id: { kind: "jellyfin", jellyfinId: "ep-1" },
      seasonNumber: 1,
      episodeNumber: 1,
    });
    const ep2 = makeEpisode({
      id: { kind: "jellyfin", jellyfinId: "ep-2" },
      seasonNumber: 1,
      episodeNumber: 2,
    });
    const ep3 = makeEpisode({
      id: { kind: "jellyfin", jellyfinId: "ep-3" },
      seasonNumber: 1,
      episodeNumber: 3,
    });
    qc.setQueryData(queryKeys.nextUp(USER_ID), [ep1]);
    qc.setQueryData(queryKeys.seasonEpisodes(USER_ID, "season-1"), [ep1, ep2, ep3]);

    applyStopReportLocally(qc, {
      jellyfinId: "ep-1",
      positionTicks: secondsToTicks(60 * 25), // 25 / 26 ≈ 96 %
      runtimeTicks: secondsToTicks(60 * 26),
      userId: USER_ID,
      nowIso: NOW,
    });

    const list = qc.getQueryData<MediaItem[]>(queryKeys.nextUp(USER_ID));
    expect(list).toHaveLength(1);
    expect((list?.[0]?.id as { jellyfinId: string }).jellyfinId).toBe("ep-2");
  });

  it("removes the played episode from nextUp when no successor is hydrated", () => {
    const ep1 = makeEpisode({
      id: { kind: "jellyfin", jellyfinId: "ep-1" },
    });
    qc.setQueryData(queryKeys.nextUp(USER_ID), [ep1]);

    applyStopReportLocally(qc, {
      jellyfinId: "ep-1",
      positionTicks: secondsToTicks(60 * 25),
      runtimeTicks: secondsToTicks(60 * 26),
      userId: USER_ID,
      nowIso: NOW,
    });

    expect(qc.getQueryData<MediaItem[]>(queryKeys.nextUp(USER_ID))).toEqual([]);
  });

  it("only patches userData when the episode hasn't crossed the played threshold", () => {
    const ep1 = makeEpisode({ id: { kind: "jellyfin", jellyfinId: "ep-1" } });
    qc.setQueryData(queryKeys.nextUp(USER_ID), [ep1]);

    applyStopReportLocally(qc, {
      jellyfinId: "ep-1",
      positionTicks: secondsToTicks(60 * 5), // 5 / 26 ≈ 19 %
      runtimeTicks: secondsToTicks(60 * 26),
      userId: USER_ID,
      nowIso: NOW,
    });

    const list = qc.getQueryData<MediaItem[]>(queryKeys.nextUp(USER_ID));
    expect(list).toHaveLength(1);
    expect((list?.[0]?.id as { jellyfinId: string }).jellyfinId).toBe("ep-1");
    expect(list?.[0]?.userData?.playbackPositionTicks).toBe(secondsToTicks(60 * 5));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// userData semantics
// ──────────────────────────────────────────────────────────────────────────────

describe("applyStopReportLocally — userData", () => {
  it("seeds a minimal UserItemData when none was present", () => {
    const item = makeMovie({ id: { kind: "jellyfin", jellyfinId: "fresh" }, userData: undefined });
    qc.setQueryData(queryKeys.movieDetail(USER_ID, "fresh"), item);

    applyStopReportLocally(qc, {
      jellyfinId: "fresh",
      positionTicks: secondsToTicks(60 * 30),
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    const patched = qc.getQueryData<MediaItem>(queryKeys.movieDetail(USER_ID, "fresh"));
    const ud = patched?.userData as UserItemData;
    expect(ud.played).toBe(false);
    expect(ud.playCount).toBe(0);
    expect(ud.playbackPositionTicks).toBe(secondsToTicks(60 * 30));
    expect(ud.lastPlayedDate).toBe(NOW);
  });

  it("increments playCount on the first crossing of the played threshold", () => {
    const item = makeMovie({
      id: { kind: "jellyfin", jellyfinId: "rewatch" },
      userData: {
        played: false,
        playCount: 0,
        playbackPositionTicks: secondsToTicks(60 * 60),
        isFavorite: false,
        lastPlayedDate: undefined,
      },
    });
    qc.setQueryData(queryKeys.movieDetail(USER_ID, "rewatch"), item);

    applyStopReportLocally(qc, {
      jellyfinId: "rewatch",
      positionTicks: secondsToTicks(60 * 115), // > 90 %
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    const patched = qc.getQueryData<MediaItem>(queryKeys.movieDetail(USER_ID, "rewatch"));
    expect(patched?.userData?.played).toBe(true);
    expect(patched?.userData?.playCount).toBe(1);
    expect(patched?.userData?.playbackPositionTicks).toBe(0);
    expect(patched?.progress).toBe(1);
  });

  it("does not increment playCount on a re-cross while already played", () => {
    const item = makeMovie({
      id: { kind: "jellyfin", jellyfinId: "rewatched" },
      userData: {
        played: true,
        playCount: 3,
        playbackPositionTicks: 0,
        isFavorite: false,
        lastPlayedDate: undefined,
      },
    });
    qc.setQueryData(queryKeys.movieDetail(USER_ID, "rewatched"), item);

    applyStopReportLocally(qc, {
      jellyfinId: "rewatched",
      positionTicks: secondsToTicks(60 * 115),
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    expect(
      qc.getQueryData<MediaItem>(queryKeys.movieDetail(USER_ID, "rewatched"))?.userData?.playCount,
    ).toBe(3);
  });

  it("falls back to position-only patch when runtimeTicks is unknown (0)", () => {
    const item = makeMovie({
      id: { kind: "jellyfin", jellyfinId: "noruntime" },
      userData: {
        played: false,
        playCount: 0,
        playbackPositionTicks: 0,
        isFavorite: false,
        lastPlayedDate: undefined,
      },
    });
    qc.setQueryData(queryKeys.movieDetail(USER_ID, "noruntime"), item);

    applyStopReportLocally(qc, {
      jellyfinId: "noruntime",
      positionTicks: HOUR_TICKS,
      runtimeTicks: 0,
      userId: USER_ID,
      nowIso: NOW,
    });

    const patched = qc.getQueryData<MediaItem>(queryKeys.movieDetail(USER_ID, "noruntime"));
    expect(patched?.userData?.played).toBe(false); // unchanged
    expect(patched?.userData?.playbackPositionTicks).toBe(HOUR_TICKS);
    expect(patched?.userData?.lastPlayedDate).toBe(NOW);
  });

  it("does not patch tmdb-only items even when ids look adjacent", () => {
    const tmdb: MediaItem = {
      ...makeMovie(),
      id: { kind: "tmdb", tmdbId: 999 },
    };
    qc.setQueryData(queryKeys.continueWatching(USER_ID), [tmdb]);

    applyStopReportLocally(qc, {
      jellyfinId: "999",
      positionTicks: secondsToTicks(60 * 30),
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    const list = qc.getQueryData<MediaItem[]>(queryKeys.continueWatching(USER_ID));
    expect(list?.[0]?.userData).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Other cache surfaces
// ──────────────────────────────────────────────────────────────────────────────

describe("applyStopReportLocally — other surfaces", () => {
  it("patches an item inside an infinite shelfPage cache", () => {
    const target = makeMovie({ id: { kind: "jellyfin", jellyfinId: "shelf-target" } });
    qc.setQueryData<
      InfiniteData<
        { items: MediaItem[]; totalRecordCount: number; nextStartIndex: number | undefined },
        number
      >
    >(queryKeys.shelfPage(USER_ID, "latest-movies"), {
      pageParams: [0],
      pages: [{ items: [target], totalRecordCount: 1, nextStartIndex: undefined }],
    });

    applyStopReportLocally(qc, {
      jellyfinId: "shelf-target",
      positionTicks: secondsToTicks(60 * 30),
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    const data = qc.getQueryData<InfiniteData<{ items: MediaItem[] }, number>>(
      queryKeys.shelfPage(USER_ID, "latest-movies"),
    );
    expect(data?.pages[0]?.items[0]?.userData?.playbackPositionTicks).toBe(secondsToTicks(60 * 30));
  });

  it("patches an item inside the jellyfin search cache", () => {
    const target = makeMovie({ id: { kind: "jellyfin", jellyfinId: "search-target" } });
    qc.setQueryData([...queryKeys.search(USER_ID, "thing"), "jellyfin", "all"], [target]);

    applyStopReportLocally(qc, {
      jellyfinId: "search-target",
      positionTicks: secondsToTicks(60 * 30),
      runtimeTicks: TWO_HOUR_TICKS,
      userId: USER_ID,
      nowIso: NOW,
    });

    const list = qc.getQueryData<MediaItem[]>([
      ...queryKeys.search(USER_ID, "thing"),
      "jellyfin",
      "all",
    ]);
    expect(list?.[0]?.userData?.playbackPositionTicks).toBe(secondsToTicks(60 * 30));
  });
});
