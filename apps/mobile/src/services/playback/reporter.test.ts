import { afterEach, describe, expect, it, vi } from "vitest";

// Mock MMKV storage for pending-store
const mockStore = new Map<string, string>();
vi.mock("@/services/query/storage", () => ({
  storage: {
    getString: (key: string) => mockStore.get(key),
    set: (key: string, value: string) => mockStore.set(key, value),
    remove: (key: string) => mockStore.delete(key),
    getAllKeys: () => [...mockStore.keys()],
  },
}));

// Mock apiFetchAuthenticated
const mockFetch = vi.fn();
vi.mock("@/services/api/client", () => ({
  apiFetchAuthenticated: (...args: unknown[]) => mockFetch(...args),
}));

import { reportStart, reportProgress, reportStopped } from "./reporter";
import { peekCount } from "./pending-store";

afterEach(() => {
  mockStore.clear();
  mockFetch.mockReset();
});

const baseArgs = {
  baseUrl: "https://jf.test",
  itemId: "item-abc",
  mediaSourceId: "src-1",
  playSessionId: "sess-1",
} as const;

describe("reportStart", () => {
  it("POSTs to /Sessions/Playing with correct body", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    await reportStart({ ...baseArgs, positionTicks: 0, playMethod: "DirectPlay" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://jf.test/Sessions/Playing");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body);
    expect(body.ItemId).toBe("item-abc");
    expect(body.PlaySessionId).toBe("sess-1");
    expect(body.MediaSourceId).toBe("src-1");
    expect(body.PositionTicks).toBe(0);
    expect(body.PlayMethod).toBe("DirectPlay");
    expect(body.CanSeek).toBe(true);
  });

  it("enqueues on HTTP error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    await reportStart({ ...baseArgs, positionTicks: 0, playMethod: "DirectPlay" });

    expect(peekCount()).toBe(1);
  });

  it("enqueues on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network request failed"));

    await reportStart({ ...baseArgs, positionTicks: 0, playMethod: "DirectPlay" });

    expect(peekCount()).toBe(1);
  });
});

describe("reportProgress", () => {
  it("POSTs to /Sessions/Playing/Progress", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    await reportProgress({
      ...baseArgs,
      positionTicks: 50_000_000_000,
      isPaused: false,
      playMethod: "Transcode",
    });

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://jf.test/Sessions/Playing/Progress");

    const body = JSON.parse(init.body);
    expect(body.PositionTicks).toBe(50_000_000_000);
    expect(body.IsPaused).toBe(false);
    expect(body.PlayMethod).toBe("Transcode");
    expect(body.EventName).toBe("timeupdate");
    expect(body.CanSeek).toBe(true);
  });
});

describe("reportStopped", () => {
  it("POSTs to /Sessions/Playing/Stopped", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    await reportStopped({ ...baseArgs, positionTicks: 72_000_000_000 });

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://jf.test/Sessions/Playing/Stopped");

    const body = JSON.parse(init.body);
    expect(body.ItemId).toBe("item-abc");
    expect(body.PositionTicks).toBe(72_000_000_000);
    expect(body.CanSeek).toBeUndefined(); // stopped doesn't need CanSeek
  });
});

describe("offline enqueue + drain round-trip", () => {
  it("queues 3 reports offline then drains them", async () => {
    // Simulate offline — all requests fail
    mockFetch.mockRejectedValue(new Error("offline"));

    await reportStart({ ...baseArgs, positionTicks: 0, playMethod: "DirectPlay" });
    await reportProgress({
      ...baseArgs,
      positionTicks: 50_000_000,
      isPaused: false,
      playMethod: "DirectPlay",
    });
    await reportProgress({
      ...baseArgs,
      positionTicks: 100_000_000,
      isPaused: false,
      playMethod: "DirectPlay",
    });

    expect(peekCount()).toBe(3);

    // Simulate coming back online — import replayReport + drain
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    const { drainReports } = await import("./pending-store");
    const { replayReport } = await import("./reporter");

    const reports = drainReports();
    expect(reports).toHaveLength(3);

    for (const report of reports) {
      await replayReport("https://jf.test", report);
    }

    // All 3 should have been re-sent (3 offline + 3 replay = 6 total)
    expect(mockFetch).toHaveBeenCalledTimes(6);
    expect(peekCount()).toBe(0);
  });
});
