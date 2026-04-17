import { describe, expect, it } from "vitest";
import { STALE_TIMES, queryKeys, type ShelfKey } from "./index";

describe("@jellyfuse/query-keys", () => {
  it("exposes stale times as finite positive numbers", () => {
    for (const [name, ms] of Object.entries(STALE_TIMES)) {
      expect(Number.isFinite(ms), `${name} must be finite`).toBe(true);
      expect(ms, `${name} must be > 0`).toBeGreaterThan(0);
    }
  });

  describe("stale times match crates/jf-core/src/query.rs::QueryKey::stale_time()", () => {
    it("continueWatching + nextUp = 60 s", () => {
      expect(STALE_TIMES.continueWatching).toBe(60 * 1000);
      expect(STALE_TIMES.nextUp).toBe(60 * 1000);
    });
    it("recentlyAdded + latestMovies + latestTv = 5 min", () => {
      expect(STALE_TIMES.recentlyAdded).toBe(5 * 60 * 1000);
      expect(STALE_TIMES.latestMovies).toBe(5 * 60 * 1000);
      expect(STALE_TIMES.latestTv).toBe(5 * 60 * 1000);
    });
    it("suggestions + requests = 2 min", () => {
      expect(STALE_TIMES.suggestions).toBe(2 * 60 * 1000);
      expect(STALE_TIMES.requests).toBe(2 * 60 * 1000);
    });
    it("movieDetail + seriesDetail = 2 min", () => {
      expect(STALE_TIMES.movieDetail).toBe(2 * 60 * 1000);
      expect(STALE_TIMES.seriesDetail).toBe(2 * 60 * 1000);
    });
    it("seasonEpisodes = 5 min, seasonInfo = 10 min", () => {
      expect(STALE_TIMES.seasonEpisodes).toBe(5 * 60 * 1000);
      expect(STALE_TIMES.seasonInfo).toBe(10 * 60 * 1000);
    });
    it("qualityProfiles = 30 min", () => {
      expect(STALE_TIMES.qualityProfiles).toBe(30 * 60 * 1000);
    });
    it("search = 30 s", () => {
      expect(STALE_TIMES.search).toBe(30 * 1000);
    });
    it("downloadProgress = 10 s", () => {
      expect(STALE_TIMES.downloadProgress).toBe(10 * 1000);
    });
    it("userConfiguration = 1 hour", () => {
      expect(STALE_TIMES.userConfiguration).toBe(60 * 60 * 1000);
    });
  });

  describe("keys are scoped by userId", () => {
    const users = ["user-a", "user-b"] as const;
    const shelves: ShelfKey[] = [
      "continue-watching",
      "next-up",
      "recently-added",
      "latest-movies",
      "latest-tv",
      "suggestions",
    ];

    it("home shelves differ across users", () => {
      for (const user of users) {
        expect(queryKeys.continueWatching(user)).toContain(user);
        expect(queryKeys.nextUp(user)).toContain(user);
        expect(queryKeys.recentlyAdded(user)).toContain(user);
        expect(queryKeys.latestMovies(user)).toContain(user);
        expect(queryKeys.latestTv(user)).toContain(user);
      }
      expect(queryKeys.continueWatching("user-a")).not.toEqual(
        queryKeys.continueWatching("user-b"),
      );
    });

    it("shelfPage is keyed by user + shelf", () => {
      for (const shelf of shelves) {
        expect(queryKeys.shelfPage("user-a", shelf)).toEqual(["shelf", "user-a", shelf]);
      }
    });

    it("detail keys are scoped by userId", () => {
      expect(queryKeys.movieDetail("user-a", "jf-1")).toContain("user-a");
      expect(queryKeys.seriesDetail("user-a", "jf-1")).toContain("user-a");
      expect(queryKeys.tmdbDetail("user-a", 603, "movie")).toContain("user-a");
    });

    it("userConfiguration is scoped by userId", () => {
      expect(queryKeys.userConfiguration("user-a")).toEqual(["user-configuration", "user-a"]);
      expect(queryKeys.userConfiguration("user-a")).not.toEqual(
        queryKeys.userConfiguration("user-b"),
      );
    });
  });
});
