import { describe, expect, it, vi } from "vitest";
import {
  fetchContinueWatching,
  fetchLatestMovies,
  fetchLatestTv,
  fetchNextUp,
  fetchRecentlyAdded,
  ShelfHttpError,
  ShelfParseError,
  type ShelfFetchArgs,
} from "./shelves";

const baseArgs: ShelfFetchArgs = {
  baseUrl: "https://jellyfin.example.com",
  userId: "user-xyz",
};

const fakeItem = {
  Id: "jf-1",
  Name: "The Matrix",
  Type: "Movie",
  ProductionYear: 1999,
  Overview: "A computer hacker learns…",
  CommunityRating: 8.7,
  RunTimeTicks: 81_600_000_000, // 136 minutes * 60 s * 10M ticks/s
  Genres: ["Action", "Sci-Fi"],
  ImageTags: { Primary: "primary-tag", Logo: "logo-tag" },
  BackdropImageTags: ["backdrop-tag"],
  ProviderIds: { Tmdb: "603" },
  UserData: {
    Played: false,
    PlayCount: 0,
    PlaybackPositionTicks: 0,
    IsFavorite: false,
    PlayedPercentage: 25,
  },
};

const fakeEpisode = {
  Id: "ep-1",
  Name: "Pilot",
  Type: "Episode",
  SeriesName: "Breaking Bad",
  SeriesId: "series-1",
  ParentIndexNumber: 1,
  IndexNumber: 1,
  ImageTags: { Primary: "primary-tag" },
  UserData: { PlaybackPositionTicks: 0 },
};

function fakeFetcher(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async (_url: string, _init?: unknown) => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  }));
}

describe("fetchContinueWatching", () => {
  it("maps the /Users/{uid}/Items/Resume response into MediaItem[]", async () => {
    const fetcher = fakeFetcher({ Items: [fakeItem], TotalRecordCount: 1 });
    const [item] = await fetchContinueWatching(baseArgs, fetcher);
    expect(item?.title).toBe("The Matrix");
    expect(item?.year).toBe(1999);
    expect(item?.runtimeMinutes).toBe(136);
    expect(item?.progress).toBe(0.25);
    expect(item?.posterUrl).toBe(
      "https://jellyfin.example.com/Items/jf-1/Images/Primary?maxWidth=400&quality=90",
    );
    expect(item?.id).toEqual({ kind: "both", jellyfinId: "jf-1", tmdbId: 603 });
  });

  it("hits the correct path + default Fields query string", async () => {
    const fetcher = fakeFetcher({ Items: [] });
    await fetchContinueWatching(baseArgs, fetcher);
    const url = fetcher.mock.calls[0]?.[0] ?? "";
    expect(url).toContain("/Users/user-xyz/Items/Resume");
    expect(url).toContain("Recursive=true");
    expect(url).toContain("MediaTypes=Video");
  });

  it("throws ShelfHttpError on non-2xx", async () => {
    const fetcher = fakeFetcher({}, { ok: false, status: 500 });
    await expect(fetchContinueWatching(baseArgs, fetcher)).rejects.toBeInstanceOf(ShelfHttpError);
  });

  it("throws ShelfParseError when Items is missing", async () => {
    const fetcher = fakeFetcher({ wrong: true });
    await expect(fetchContinueWatching(baseArgs, fetcher)).rejects.toBeInstanceOf(ShelfParseError);
  });
});

describe("fetchNextUp", () => {
  it("hits /Shows/NextUp with UserId param and overrides episode poster with series poster", async () => {
    const fetcher = fakeFetcher({ Items: [fakeEpisode] });
    const [item] = await fetchNextUp(baseArgs, fetcher);
    const url = fetcher.mock.calls[0]?.[0] ?? "";
    expect(url).toContain("/Shows/NextUp?");
    expect(url).toContain("UserId=user-xyz");
    // Poster should point at the series, not the episode
    expect(item?.posterUrl).toBe(
      "https://jellyfin.example.com/Items/series-1/Images/Primary?maxWidth=400&quality=90",
    );
    expect(item?.backdropUrl).toBe(
      "https://jellyfin.example.com/Items/series-1/Images/Backdrop?maxWidth=1280&quality=90",
    );
  });
});

describe("fetchRecentlyAdded", () => {
  it("decodes a bare array response from /Users/{uid}/Items/Latest", async () => {
    const fetcher = fakeFetcher([fakeItem]);
    const [item] = await fetchRecentlyAdded(baseArgs, fetcher);
    expect(item?.title).toBe("The Matrix");
    const url = fetcher.mock.calls[0]?.[0] ?? "";
    expect(url).toContain("/Users/user-xyz/Items/Latest");
  });

  it("throws ShelfParseError when the response is not an array", async () => {
    const fetcher = fakeFetcher({ Items: [] });
    await expect(fetchRecentlyAdded(baseArgs, fetcher)).rejects.toBeInstanceOf(ShelfParseError);
  });
});

describe("fetchLatestMovies", () => {
  it("sends IncludeItemTypes=Movie + SortBy=DateCreated", async () => {
    const fetcher = fakeFetcher({ Items: [fakeItem] });
    await fetchLatestMovies(baseArgs, fetcher);
    const url = fetcher.mock.calls[0]?.[0] ?? "";
    expect(url).toContain("IncludeItemTypes=Movie");
    expect(url).toContain("SortBy=DateCreated");
    expect(url).toContain("SortOrder=Descending");
  });
});

describe("fetchLatestTv", () => {
  it("sends IncludeItemTypes=Series", async () => {
    const fetcher = fakeFetcher({ Items: [] });
    await fetchLatestTv(baseArgs, fetcher);
    const url = fetcher.mock.calls[0]?.[0] ?? "";
    expect(url).toContain("IncludeItemTypes=Series");
  });
});

describe("base-URL handling", () => {
  it("tolerates a trailing slash on baseUrl", async () => {
    const fetcher = fakeFetcher({ Items: [] });
    await fetchContinueWatching({ ...baseArgs, baseUrl: "https://jellyfin.example.com/" }, fetcher);
    const url = fetcher.mock.calls[0]?.[0] ?? "";
    expect(url.startsWith("https://jellyfin.example.com/Users/user-xyz/Items/Resume")).toBe(true);
  });
});
