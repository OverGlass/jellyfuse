import type { MediaItem } from "@jellyfuse/models";
import { isAffectedQuery, patchCache, patchMediaItemPlayed } from "./played-cache-patch";

function movie(jellyfinId: string, played: boolean): MediaItem {
  return {
    id: { kind: "jellyfin", jellyfinId },
    source: "jellyfin",
    availability: { kind: "available" },
    mediaType: "movie",
    title: `Movie ${jellyfinId}`,
    sortTitle: undefined,
    year: 2024,
    overview: undefined,
    posterUrl: undefined,
    backdropUrl: undefined,
    logoUrl: undefined,
    genres: [],
    rating: undefined,
    progress: 0.42,
    runtimeMinutes: 100,
    userData: {
      played,
      playCount: played ? 1 : 0,
      playbackPositionTicks: played ? 0 : 100,
      isFavorite: false,
      lastPlayedDate: undefined,
      unplayedItemCount: undefined,
    },
    seasonCount: undefined,
    episodeCount: undefined,
    seriesName: undefined,
    seasonNumber: undefined,
    episodeNumber: undefined,
    seriesId: undefined,
    seasonId: undefined,
  };
}

describe("patchMediaItemPlayed", () => {
  it("marks unplayed → played: sets played, bumps playCount, stamps lastPlayedDate, preserves resume", () => {
    const before = movie("m1", false);
    const after = patchMediaItemPlayed(before, "m1", undefined, true);
    expect(after).not.toBe(before);
    expect(after.userData?.played).toBe(true);
    expect(after.userData?.playCount).toBe(1);
    expect(after.userData?.lastPlayedDate).toBeDefined();
    expect(after.progress).toBe(0.42); // resume preserved
  });

  it("marks played → unplayed: clears played, resets counts, drops resume", () => {
    const before = movie("m1", true);
    const after = patchMediaItemPlayed(before, "m1", undefined, false);
    expect(after.userData?.played).toBe(false);
    expect(after.userData?.playCount).toBe(0);
    expect(after.userData?.playbackPositionTicks).toBe(0);
    expect(after.userData?.lastPlayedDate).toBeUndefined();
    expect(after.progress).toBe(0);
  });

  it("returns the same reference when nothing matches", () => {
    const before = movie("m1", false);
    const after = patchMediaItemPlayed(before, "other-id", undefined, true);
    expect(after).toBe(before);
  });

  it("patches a series item via the seriesId match (lastPlayedDate only)", () => {
    const series = movie("s1", false);
    const after = patchMediaItemPlayed(series, "ep-99", "s1", true);
    expect(after).not.toBe(series);
    // Direct fields untouched — server reconciles aggregate counts on
    // next refetch.
    expect(after.userData?.played).toBe(false);
    expect(after.userData?.playCount).toBe(0);
    expect(after.userData?.lastPlayedDate).toBeDefined();
  });

  it("seeds default UserItemData when the original item had none", () => {
    const naked = { ...movie("m1", false), userData: undefined };
    const after = patchMediaItemPlayed(naked, "m1", undefined, true);
    expect(after.userData).toMatchObject({ played: true, playCount: 1 });
  });
});

describe("patchCache", () => {
  it("patches a single item slot (e.g. movieDetail / seriesDetail)", () => {
    const cached = movie("m1", false);
    const patched = patchCache(cached, "m1", undefined, true) as MediaItem;
    expect(patched.userData?.played).toBe(true);
  });

  it("patches the matching entry in a list (shelves / season-episodes)", () => {
    const cached = [movie("m1", false), movie("m2", false), movie("m3", false)];
    const patched = patchCache(cached, "m2", undefined, true) as MediaItem[];
    expect(patched).not.toBe(cached);
    expect(patched[0]).toBe(cached[0]);
    expect(patched[2]).toBe(cached[2]);
    expect(patched[1]?.userData?.played).toBe(true);
  });

  it("returns the same array reference when no entry matches", () => {
    const cached = [movie("m1", false), movie("m2", false)];
    expect(patchCache(cached, "missing", undefined, true)).toBe(cached);
  });

  it("ignores unrelated cache shapes", () => {
    const cached = { something: "else" };
    expect(patchCache(cached, "m1", undefined, true)).toBe(cached);
  });

  it("patches a single ShelfPage (`{ items: MediaItem[], … }`)", () => {
    const page = { items: [movie("m1", false)], totalRecordCount: 1, nextStartIndex: 50 };
    const patched = patchCache(page, "m1", undefined, true) as typeof page;
    expect(patched).not.toBe(page);
    expect(patched.totalRecordCount).toBe(1);
    expect(patched.items[0]?.userData?.played).toBe(true);
  });

  it("patches an InfiniteQuery page bag (`{ pages: ShelfPage[], pageParams }`)", () => {
    const bag = {
      pages: [
        { items: [movie("m1", false), movie("m2", false)], totalRecordCount: 2 },
        { items: [movie("m3", false)], totalRecordCount: 2 },
      ],
      pageParams: [0, 50],
    };
    const patched = patchCache(bag, "m3", undefined, true) as typeof bag;
    expect(patched).not.toBe(bag);
    expect(patched.pages[0]).toBe(bag.pages[0]); // unchanged page kept by reference
    expect(patched.pages[1]).not.toBe(bag.pages[1]);
    expect(patched.pages[1]?.items[0]?.userData?.played).toBe(true);
  });

  it("returns the same infinite bag reference when no entry matches", () => {
    const bag = { pages: [{ items: [movie("m1", false)] }], pageParams: [0] };
    expect(patchCache(bag, "missing", undefined, true)).toBe(bag);
  });
});

describe("isAffectedQuery", () => {
  const cases: { key: readonly unknown[]; expected: boolean }[] = [
    { key: ["home", "u", "continue-watching"], expected: true },
    { key: ["home", "u", "next-up"], expected: true },
    { key: ["home", "u", "recently-added"], expected: true },
    { key: ["home", "u", "latest-movies"], expected: true },
    { key: ["home", "u", "latest-tv"], expected: true },
    { key: ["home", "u", "suggestions"], expected: true },
    { key: ["shelf", "u", "recently-added"], expected: true },
    { key: ["shelf", "u", "latest-movies"], expected: true },
    { key: ["shelf", "u", "continue-watching"], expected: true },
    { key: ["detail", "u", "movie", "id"], expected: true },
    { key: ["detail", "u", "series", "id"], expected: true },
    { key: ["detail", "u", "season-episodes", "id"], expected: true },
    { key: ["detail", "u", "tmdb", 1, "movie"], expected: false },
    { key: ["detail", "u", "adjacent-episode", "s", "e"], expected: false },
    { key: ["search", "u", "q"], expected: false },
  ];
  it.each(cases)("$key → $expected", ({ key, expected }) => {
    expect(isAffectedQuery({ queryKey: key as readonly unknown[] })).toBe(expected);
  });
});
