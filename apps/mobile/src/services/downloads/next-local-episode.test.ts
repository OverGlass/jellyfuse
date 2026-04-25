import type { DownloadRecord } from "@jellyfuse/models";
import { findNextLocalEpisode } from "./next-local-episode";

function record(partial: Partial<DownloadRecord> & Pick<DownloadRecord, "itemId">): DownloadRecord {
  return {
    id: `id-${partial.itemId}`,
    itemId: partial.itemId,
    mediaSourceId: `ms-${partial.itemId}`,
    playSessionId: `ps-${partial.itemId}`,
    title: partial.title ?? `Episode ${partial.episodeNumber ?? "?"}`,
    seriesTitle: partial.seriesTitle ?? "Test Series",
    seasonNumber: partial.seasonNumber,
    episodeNumber: partial.episodeNumber,
    imageUrl: undefined,
    streamUrl: "",
    destRelativePath: `downloads/${partial.itemId}/media`,
    bytesDownloaded: 100,
    bytesTotal: 100,
    state: partial.state ?? "done",
    metadata: {
      durationSeconds: 1800,
      chapters: [],
      trickplayInfo: undefined,
      introSkipperSegments: undefined,
    },
    wasOriginal: true,
    trickplayTileCount: 0,
    subtitleSidecars: [],
    addedAtMs: 0,
  };
}

describe("findNextLocalEpisode", () => {
  it("returns the next episode in the same series, sorted by season then episode", () => {
    const records = [
      record({ itemId: "ep1", seasonNumber: 1, episodeNumber: 1 }),
      record({ itemId: "ep2", seasonNumber: 1, episodeNumber: 2 }),
      record({ itemId: "ep3", seasonNumber: 1, episodeNumber: 3 }),
    ];
    expect(findNextLocalEpisode(records, "ep1")?.itemId).toBe("ep2");
    expect(findNextLocalEpisode(records, "ep2")?.itemId).toBe("ep3");
  });

  it("returns undefined at the end of the downloaded run", () => {
    const records = [
      record({ itemId: "ep1", seasonNumber: 1, episodeNumber: 1 }),
      record({ itemId: "ep2", seasonNumber: 1, episodeNumber: 2 }),
    ];
    expect(findNextLocalEpisode(records, "ep2")).toBeUndefined();
  });

  it("crosses season boundaries", () => {
    const records = [
      record({ itemId: "s1e10", seasonNumber: 1, episodeNumber: 10 }),
      record({ itemId: "s2e1", seasonNumber: 2, episodeNumber: 1 }),
    ];
    expect(findNextLocalEpisode(records, "s1e10")?.itemId).toBe("s2e1");
  });

  it("ignores records from other series", () => {
    const records = [
      record({ itemId: "a1", seriesTitle: "Show A", seasonNumber: 1, episodeNumber: 1 }),
      record({ itemId: "b1", seriesTitle: "Show B", seasonNumber: 1, episodeNumber: 1 }),
      record({ itemId: "a2", seriesTitle: "Show A", seasonNumber: 1, episodeNumber: 2 }),
    ];
    expect(findNextLocalEpisode(records, "a1")?.itemId).toBe("a2");
  });

  it("ignores incomplete downloads (queued/downloading/paused/failed)", () => {
    const records = [
      record({ itemId: "ep1", seasonNumber: 1, episodeNumber: 1 }),
      record({ itemId: "ep2", seasonNumber: 1, episodeNumber: 2, state: "downloading" }),
      record({ itemId: "ep3", seasonNumber: 1, episodeNumber: 3 }),
    ];
    expect(findNextLocalEpisode(records, "ep1")?.itemId).toBe("ep3");
  });

  it("skips gaps in the downloaded run (non-contiguous episodes)", () => {
    const records = [
      record({ itemId: "ep1", seasonNumber: 1, episodeNumber: 1 }),
      record({ itemId: "ep4", seasonNumber: 1, episodeNumber: 4 }),
    ];
    expect(findNextLocalEpisode(records, "ep1")?.itemId).toBe("ep4");
  });

  it("returns undefined when the current itemId is not downloaded", () => {
    const records = [record({ itemId: "ep1", seasonNumber: 1, episodeNumber: 1 })];
    expect(findNextLocalEpisode(records, "missing")).toBeUndefined();
  });

  it("returns undefined when the current record lacks season/episode metadata", () => {
    const records = [
      record({ itemId: "movie", seasonNumber: undefined, episodeNumber: undefined }),
    ];
    expect(findNextLocalEpisode(records, "movie")).toBeUndefined();
  });

  it("ignores records in the same series that lack season/episode metadata", () => {
    const records = [
      record({ itemId: "ep1", seasonNumber: 1, episodeNumber: 1 }),
      record({ itemId: "extra", seasonNumber: undefined, episodeNumber: undefined }),
      record({ itemId: "ep2", seasonNumber: 1, episodeNumber: 2 }),
    ];
    expect(findNextLocalEpisode(records, "ep1")?.itemId).toBe("ep2");
  });

  it("handles unsorted input deterministically", () => {
    const records = [
      record({ itemId: "ep3", seasonNumber: 1, episodeNumber: 3 }),
      record({ itemId: "ep1", seasonNumber: 1, episodeNumber: 1 }),
      record({ itemId: "ep2", seasonNumber: 1, episodeNumber: 2 }),
    ];
    expect(findNextLocalEpisode(records, "ep1")?.itemId).toBe("ep2");
    expect(findNextLocalEpisode(records, "ep2")?.itemId).toBe("ep3");
  });
});
