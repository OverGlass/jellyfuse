import type { Query } from "@tanstack/react-query";
import { shouldDehydrateQuery } from "./should-dehydrate";

function makeQuery(
  queryKey: readonly unknown[],
  status: "success" | "error" | "pending" = "success",
): Query {
  return {
    queryKey,
    state: { status },
  } as unknown as Query;
}

describe("shouldDehydrateQuery", () => {
  describe("persists", () => {
    it.each([
      ["system-info", ["system-info", "https://jellyfin.example.com"]],
      ["home continue-watching", ["home", "user-xyz", "continue-watching"]],
      ["home next-up", ["home", "user-xyz", "next-up"]],
      ["home recently-added", ["home", "user-xyz", "recently-added"]],
      ["home latest-movies", ["home", "user-xyz", "latest-movies"]],
      ["home latest-tv", ["home", "user-xyz", "latest-tv"]],
      ["home suggestions", ["home", "user-xyz", "suggestions"]],
      ["detail movie", ["detail", "user-xyz", "movie", "jf-1"]],
      ["detail series", ["detail", "user-xyz", "series", "jf-1"]],
      ["detail season-episodes", ["detail", "user-xyz", "season-episodes", "season-1"]],
      ["shelf page", ["shelf", "user-xyz", "latest-movies"]],
      ["quality-profiles", ["quality-profiles"]],
    ])("%s", (_name, key) => {
      expect(shouldDehydrateQuery(makeQuery(key))).toBe(true);
    });
  });

  describe("excludes", () => {
    it.each([
      ["auth persisted", ["auth", "persisted"]],
      ["auth context", ["auth", "context", "user-xyz"]],
      ["playback info", ["playback", "user-xyz", "info", "jf-1"]],
      ["download-progress", ["download-progress", 603]],
      ["download-progress-map", ["download-progress-map"]],
      ["local-downloads list", ["local-downloads", "user-xyz"]],
      ["search query", ["search", "user-xyz", "matrix"]],
    ])("%s", (_name, key) => {
      expect(shouldDehydrateQuery(makeQuery(key))).toBe(false);
    });
  });

  describe("status filter", () => {
    it("skips queries in error state even when the key is persistable", () => {
      expect(shouldDehydrateQuery(makeQuery(["home", "user-xyz", "latest-tv"], "error"))).toBe(
        false,
      );
    });
    it("skips pending queries", () => {
      expect(shouldDehydrateQuery(makeQuery(["home", "user-xyz", "latest-tv"], "pending"))).toBe(
        false,
      );
    });
  });

  describe("unknown top-level key", () => {
    it("is conservative and skips persistence", () => {
      expect(shouldDehydrateQuery(makeQuery(["future-feature", "x"]))).toBe(false);
    });
    it("handles non-string top-level keys", () => {
      expect(shouldDehydrateQuery(makeQuery([42, "x"]))).toBe(false);
    });
  });
});
