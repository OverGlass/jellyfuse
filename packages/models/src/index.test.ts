import { describe, expect, it } from "vitest";
import {
  episodeLabel,
  MODELS_PACKAGE_VERSION,
  type MediaItem,
  mediaIdJellyfin,
  mediaIdTmdb,
  mediaItemSubtitle,
} from "./index";

const base: MediaItem = {
  id: { kind: "jellyfin", jellyfinId: "jf-1" },
  source: "jellyfin",
  availability: { kind: "available" },
  mediaType: "movie",
  title: "The Matrix",
  sortTitle: undefined,
  year: 1999,
  overview: undefined,
  posterUrl: undefined,
  backdropUrl: undefined,
  logoUrl: undefined,
  genres: [],
  rating: undefined,
  progress: undefined,
  runtimeMinutes: 136,
  userData: undefined,
  seasonCount: undefined,
  episodeCount: undefined,
  seriesName: undefined,
  seasonNumber: undefined,
  episodeNumber: undefined,
  seriesId: undefined,
  seasonId: undefined,
};

describe("@jellyfuse/models", () => {
  it("exports a package version marker", () => {
    expect(MODELS_PACKAGE_VERSION).toBe("0.0.1");
  });

  describe("mediaIdJellyfin / mediaIdTmdb", () => {
    it("extracts both ids from a 'both' media id", () => {
      const id = { kind: "both" as const, jellyfinId: "jf-x", tmdbId: 603 };
      expect(mediaIdJellyfin(id)).toBe("jf-x");
      expect(mediaIdTmdb(id)).toBe(603);
    });

    it("returns undefined for the missing side", () => {
      expect(mediaIdTmdb({ kind: "jellyfin", jellyfinId: "jf-1" })).toBeUndefined();
      expect(mediaIdJellyfin({ kind: "tmdb", tmdbId: 42 })).toBeUndefined();
    });
  });

  describe("episodeLabel", () => {
    it("returns S2 · E4 when both season and episode numbers are set", () => {
      expect(episodeLabel({ ...base, seasonNumber: 2, episodeNumber: 4 })).toBe("S2 · E4");
    });

    it("returns S2 when only the season number is set", () => {
      expect(episodeLabel({ ...base, seasonNumber: 2 })).toBe("S2");
    });

    it("returns undefined for movies", () => {
      expect(episodeLabel(base)).toBeUndefined();
    });
  });

  describe("mediaItemSubtitle", () => {
    it("formats a movie as 'year · runtime'", () => {
      expect(mediaItemSubtitle(base)).toBe("1999 · 2h 16m");
    });

    it("formats a sub-hour runtime as Nm", () => {
      expect(mediaItemSubtitle({ ...base, runtimeMinutes: 42 })).toBe("1999 · 42m");
    });

    it("formats a series as 'year · N Seasons'", () => {
      const series: MediaItem = {
        ...base,
        mediaType: "series",
        runtimeMinutes: undefined,
        seasonCount: 3,
      };
      expect(mediaItemSubtitle(series)).toBe("1999 · 3 Seasons");
    });

    it("uses the singular form for one season", () => {
      const series: MediaItem = {
        ...base,
        mediaType: "series",
        runtimeMinutes: undefined,
        seasonCount: 1,
      };
      expect(mediaItemSubtitle(series)).toBe("1999 · 1 Season");
    });
  });
});
