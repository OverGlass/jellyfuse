import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingReport } from "@jellyfuse/models";

// Mock MMKV storage
const mockStore = new Map<string, string>();
vi.mock("@/services/query/storage", () => ({
  storage: {
    getString: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => mockStore.set(key, value),
    remove: (key: string) => mockStore.delete(key),
    getAllKeys: () => [...mockStore.keys()],
  },
}));

import { clearPendingReports, drainReports, enqueueReport, peekCount } from "./pending-store";

function makeReport(overrides: Partial<PendingReport> = {}): PendingReport {
  return {
    itemId: "item-1",
    playSessionId: "sess-1",
    mediaSourceId: "src-1",
    kind: {
      type: "progress",
      positionTicks: 100_000_000,
      isPaused: false,
      playMethod: "DirectPlay",
    },
    occurredAtMs: Date.now(),
    ...overrides,
  };
}

afterEach(() => {
  mockStore.clear();
});

describe("pending-store", () => {
  it("enqueues and drains a single report", () => {
    const report = makeReport({ occurredAtMs: 1000 });
    enqueueReport(report);

    expect(peekCount()).toBe(1);

    const drained = drainReports();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.itemId).toBe("item-1");
    expect(peekCount()).toBe(0);
  });

  it("drains in FIFO order by timestamp", () => {
    enqueueReport(makeReport({ occurredAtMs: 3000, itemId: "third" }));
    enqueueReport(makeReport({ occurredAtMs: 1000, itemId: "first" }));
    enqueueReport(makeReport({ occurredAtMs: 2000, itemId: "second" }));

    const drained = drainReports();
    expect(drained.map((r) => r.itemId)).toEqual(["first", "second", "third"]);
  });

  it("evicts oldest entries when exceeding cap", () => {
    // Enqueue 502 reports
    for (let i = 0; i < 502; i++) {
      enqueueReport(
        makeReport({
          occurredAtMs: i,
          itemId: `item-${String(i).padStart(4, "0")}`,
        }),
      );
    }

    // Should be capped at 500
    expect(peekCount()).toBe(500);

    // Oldest 2 (item-0000, item-0001) should be evicted
    const drained = drainReports();
    expect(drained[0]!.itemId).toBe("item-0002");
  });

  it("returns empty array when nothing queued", () => {
    expect(drainReports()).toEqual([]);
    expect(peekCount()).toBe(0);
  });

  it("skips corrupted entries during drain", () => {
    // Manually insert a corrupted entry
    mockStore.set("playback-pending:v1:1000:item-1:progress", "not-json{{{");
    enqueueReport(makeReport({ occurredAtMs: 2000, itemId: "good" }));

    const drained = drainReports();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.itemId).toBe("good");
    expect(peekCount()).toBe(0); // corrupted entry was removed
  });

  it("clearPendingReports removes all entries", () => {
    enqueueReport(makeReport({ occurredAtMs: 1000 }));
    enqueueReport(makeReport({ occurredAtMs: 2000 }));
    expect(peekCount()).toBe(2);

    clearPendingReports();
    expect(peekCount()).toBe(0);
  });

  it("does not interfere with other MMKV keys", () => {
    mockStore.set("nav-state:v1:/home", '{"offset":100}');
    enqueueReport(makeReport({ occurredAtMs: 1000 }));

    expect(peekCount()).toBe(1);
    drainReports();
    // Nav state key should still be there
    expect(mockStore.has("nav-state:v1:/home")).toBe(true);
  });
});
