import type { Availability, MediaId, MediaItem, MediaType } from "@jellyfuse/models";
import { describe, expect, it, vi } from "vitest";
import {
  blendSearchResults,
  fetchJellyfinSearch,
  fetchJellyseerrSearch,
  normalizeTitle,
  SearchHttpError,
  SearchParseError,
} from "./search";

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<MediaItem> & Pick<MediaItem, "id" | "title">): MediaItem {
  const availability: Availability = overrides.availability ?? { kind: "available" };
  const mediaType: MediaType = overrides.mediaType ?? "movie";
  return {
    id: overrides.id,
    source: overrides.source ?? "jellyfin",
    availability,
    mediaType,
    title: overrides.title,
    sortTitle: overrides.sortTitle,
    year: overrides.year,
    overview: overrides.overview,
    posterUrl: overrides.posterUrl,
    backdropUrl: overrides.backdropUrl,
    logoUrl: overrides.logoUrl,
    genres: overrides.genres ?? [],
    rating: overrides.rating,
    progress: overrides.progress,
    runtimeMinutes: overrides.runtimeMinutes,
    userData: overrides.userData,
    seasonCount: overrides.seasonCount,
    episodeCount: overrides.episodeCount,
    seriesName: overrides.seriesName,
    seasonNumber: overrides.seasonNumber,
    episodeNumber: overrides.episodeNumber,
    seriesId: overrides.seriesId,
    seasonId: overrides.seasonId,
  };
}

function libItem(jellyfinId: string, tmdbId: number | undefined, title: string): MediaItem {
  const id: MediaId =
    tmdbId !== undefined ? { kind: "both", jellyfinId, tmdbId } : { kind: "jellyfin", jellyfinId };
  return makeItem({ id, title, source: "jellyfin" });
}

function tmdbItem(tmdbId: number, title: string): MediaItem {
  return makeItem({ id: { kind: "tmdb", tmdbId }, title, source: "jellyseerr" });
}

interface FakeHttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

function fakeFetcher(response: Partial<FakeHttpResponse> = {}) {
  return vi.fn(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.body ?? {},
  }));
}

// ──────────────────────────────────────────────────────────────────────
// normalizeTitle
// ──────────────────────────────────────────────────────────────────────

describe("normalizeTitle", () => {
  it("lowercases and trims", () => {
    expect(normalizeTitle("  The Matrix  ")).toBe("the matrix");
  });

  it("collapses inner whitespace", () => {
    expect(normalizeTitle("The    Matrix\tReloaded")).toBe("the matrix reloaded");
  });

  it("handles empty input", () => {
    expect(normalizeTitle("   ")).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────────────
// blendSearchResults
// ──────────────────────────────────────────────────────────────────────

describe("blendSearchResults", () => {
  it("passes library items through unchanged", () => {
    const library = [libItem("a", 100, "The Matrix"), libItem("b", undefined, "Memento")];
    const result = blendSearchResults(library, []);
    expect(result.libraryItems).toEqual(library);
    expect(result.requestableItems).toEqual([]);
  });

  it("drops a Jellyseerr result whose TMDB id is in the library", () => {
    const library = [libItem("a", 603, "The Matrix")];
    const js = [tmdbItem(603, "The Matrix"), tmdbItem(604, "The Matrix Reloaded")];
    const result = blendSearchResults(library, js);
    expect(result.requestableItems).toHaveLength(1);
    expect(result.requestableItems[0]?.title).toBe("The Matrix Reloaded");
  });

  it("falls back to normalized-title dedupe when TMDB id is absent on library side", () => {
    const library = [libItem("a", undefined, "THE  Matrix ")];
    const js = [tmdbItem(603, "the matrix")];
    const result = blendSearchResults(library, js);
    expect(result.requestableItems).toEqual([]);
  });

  it("keeps a Jellyseerr result that only collides by a partial title prefix", () => {
    const library = [libItem("a", undefined, "The Matrix")];
    const js = [tmdbItem(604, "The Matrix Reloaded")];
    const result = blendSearchResults(library, js);
    expect(result.requestableItems).toHaveLength(1);
  });

  it("preserves input order inside each output array", () => {
    const library = [libItem("a", 1, "A"), libItem("b", 2, "B"), libItem("c", 3, "C")];
    const js = [tmdbItem(10, "X"), tmdbItem(11, "Y"), tmdbItem(12, "Z")];
    const result = blendSearchResults(library, js);
    expect(result.libraryItems.map((i: MediaItem) => i.title)).toEqual(["A", "B", "C"]);
    expect(result.requestableItems.map((i: MediaItem) => i.title)).toEqual(["X", "Y", "Z"]);
  });

  it("handles both empty arrays", () => {
    expect(blendSearchResults([], [])).toEqual({ libraryItems: [], requestableItems: [] });
  });

  it("handles library-only (no TMDB match, no title match)", () => {
    const library = [libItem("a", 100, "The Matrix")];
    const js = [tmdbItem(200, "Inception"), tmdbItem(300, "Dune")];
    const result = blendSearchResults(library, js);
    expect(result.requestableItems.map((i: MediaItem) => i.title)).toEqual(["Inception", "Dune"]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// fetchJellyfinSearch
// ──────────────────────────────────────────────────────────────────────

describe("fetchJellyfinSearch", () => {
  const baseArgs = {
    baseUrl: "https://jellyfin.example.com",
    userId: "user-1",
    query: "matrix",
  };

  it("short-circuits on empty query", async () => {
    const fetcher = fakeFetcher();
    const result = await fetchJellyfinSearch({ ...baseArgs, query: "  " }, fetcher as never);
    expect(result).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hits the user items endpoint with search params and maps the response", async () => {
    const fetcher = fakeFetcher({
      body: {
        Items: [
          {
            Id: "jf-1",
            Name: "The Matrix",
            Type: "Movie",
            ProductionYear: 1999,
            ProviderIds: { Tmdb: "603" },
            ImageTags: { Primary: "abc" },
          },
          {
            Id: "jf-2",
            Name: "Matrix Reloaded",
            Type: "Movie",
            ProductionYear: 2003,
            ImageTags: {},
          },
        ],
      },
    });
    const result = await fetchJellyfinSearch(baseArgs, fetcher as never);
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toContain("/Users/user-1/Items?");
    expect(url).toContain("SearchTerm=matrix");
    expect(url).toContain("IncludeItemTypes=Movie%2CSeries");
    expect(url).toContain("Limit=25");
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toEqual({ kind: "both", jellyfinId: "jf-1", tmdbId: 603 });
    expect(result[1]?.id).toEqual({ kind: "jellyfin", jellyfinId: "jf-2" });
  });

  it("respects a caller-supplied limit", async () => {
    const fetcher = fakeFetcher({ body: { Items: [] } });
    await fetchJellyfinSearch({ ...baseArgs, limit: 10 }, fetcher as never);
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toContain("Limit=10");
  });

  it("throws SearchHttpError on non-2xx", async () => {
    const fetcher = fakeFetcher({ ok: false, status: 500 });
    await expect(fetchJellyfinSearch(baseArgs, fetcher as never)).rejects.toBeInstanceOf(
      SearchHttpError,
    );
  });

  it("throws SearchParseError when the payload is missing Items", async () => {
    const fetcher = fakeFetcher({ body: { oops: true } });
    await expect(fetchJellyfinSearch(baseArgs, fetcher as never)).rejects.toBeInstanceOf(
      SearchParseError,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────
// fetchJellyseerrSearch
// ──────────────────────────────────────────────────────────────────────

describe("fetchJellyseerrSearch", () => {
  const baseArgs = { baseUrl: "https://jellyseerr.example.com", query: "matrix" };

  it("short-circuits on empty query", async () => {
    const fetcher = fakeFetcher();
    const result = await fetchJellyseerrSearch({ ...baseArgs, query: "" }, fetcher as never);
    expect(result).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps movie and tv entries and drops person / unknown", async () => {
    const fetcher = fakeFetcher({
      body: {
        results: [
          {
            id: 603,
            mediaType: "movie",
            title: "The Matrix",
            releaseDate: "1999-03-31",
            overview: "A computer hacker learns…",
            posterPath: "/matrix.jpg",
            backdropPath: "/matrix-bd.jpg",
            voteAverage: 8.2,
            mediaInfo: { status: 5 },
          },
          {
            id: 1399,
            mediaType: "tv",
            name: "Game of Thrones",
            firstAirDate: "2011-04-17",
            posterPath: "/got.jpg",
            voteAverage: 9.0,
            mediaInfo: { status: 2 },
          },
          { id: 1, mediaType: "person", name: "Keanu Reeves" },
          { id: 2, mediaType: "movie", title: null },
        ],
      },
    });
    const result = await fetchJellyseerrSearch(baseArgs, fetcher as never);
    expect(result).toHaveLength(2);

    const matrix = result[0]!;
    expect(matrix.id).toEqual({ kind: "tmdb", tmdbId: 603 });
    expect(matrix.mediaType).toBe("movie");
    expect(matrix.title).toBe("The Matrix");
    expect(matrix.year).toBe(1999);
    expect(matrix.posterUrl).toBe("https://image.tmdb.org/t/p/w500/matrix.jpg");
    expect(matrix.backdropUrl).toBe("https://image.tmdb.org/t/p/w1280/matrix-bd.jpg");
    expect(matrix.rating).toBe(8.2);
    expect(matrix.availability).toEqual({ kind: "available" });
    expect(matrix.source).toBe("jellyseerr");

    const got = result[1]!;
    expect(got.id).toEqual({ kind: "tmdb", tmdbId: 1399 });
    expect(got.mediaType).toBe("series");
    expect(got.title).toBe("Game of Thrones");
    expect(got.year).toBe(2011);
    expect(got.availability).toEqual({ kind: "requested", status: "pending" });
  });

  it("maps missing mediaInfo to kind: missing", async () => {
    const fetcher = fakeFetcher({
      body: {
        results: [{ id: 999, mediaType: "movie", title: "Dune", releaseDate: "2021-10-22" }],
      },
    });
    const result = await fetchJellyseerrSearch(baseArgs, fetcher as never);
    expect(result[0]?.availability).toEqual({ kind: "missing" });
  });

  it("builds the expected URL with query and page", async () => {
    const fetcher = fakeFetcher({ body: { results: [] } });
    await fetchJellyseerrSearch({ ...baseArgs, page: 2 }, fetcher as never);
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://jellyseerr.example.com/api/v1/search?query=matrix&page=2");
  });

  it("throws SearchHttpError on 401", async () => {
    const fetcher = fakeFetcher({ ok: false, status: 401 });
    await expect(fetchJellyseerrSearch(baseArgs, fetcher as never)).rejects.toBeInstanceOf(
      SearchHttpError,
    );
  });

  it("throws SearchParseError when the payload is missing results", async () => {
    const fetcher = fakeFetcher({ body: { oops: true } });
    await expect(fetchJellyseerrSearch(baseArgs, fetcher as never)).rejects.toBeInstanceOf(
      SearchParseError,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────
// End-to-end: blend wired against fake fetchers
// ──────────────────────────────────────────────────────────────────────

describe("blendSearchResults end-to-end", () => {
  it("merges real-shape Jellyfin + Jellyseerr responses and dedupes by TMDB id", async () => {
    const jfFetcher = fakeFetcher({
      body: {
        Items: [
          {
            Id: "jf-1",
            Name: "The Matrix",
            Type: "Movie",
            ProductionYear: 1999,
            ProviderIds: { Tmdb: "603" },
            ImageTags: { Primary: "x" },
          },
        ],
      },
    });
    const jsFetcher = fakeFetcher({
      body: {
        results: [
          { id: 603, mediaType: "movie", title: "The Matrix", releaseDate: "1999-03-31" },
          { id: 604, mediaType: "movie", title: "The Matrix Reloaded", releaseDate: "2003-05-15" },
          {
            id: 605,
            mediaType: "movie",
            title: "The Matrix Revolutions",
            releaseDate: "2003-11-05",
          },
        ],
      },
    });

    const [library, requestable] = await Promise.all([
      fetchJellyfinSearch(
        { baseUrl: "https://jf.example.com", userId: "u-1", query: "matrix" },
        jfFetcher as never,
      ),
      fetchJellyseerrSearch(
        { baseUrl: "https://js.example.com", query: "matrix" },
        jsFetcher as never,
      ),
    ]);

    const blended = blendSearchResults(library, requestable);
    expect(blended.libraryItems.map((i: MediaItem) => i.title)).toEqual(["The Matrix"]);
    expect(blended.requestableItems.map((i: MediaItem) => i.title)).toEqual([
      "The Matrix Reloaded",
      "The Matrix Revolutions",
    ]);
  });
});
