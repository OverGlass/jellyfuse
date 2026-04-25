import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` runs before any `vi.mock` factory, which is itself
// hoisted to the top of the file. This is the only way to share
// state between top-level mocks and the test body without tripping
// the "cannot access X before initialization" footgun.
const hoisted = vi.hoisted(async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return {
    mockStore: new Map<string, string>(),
    mockFetch: vi.fn(),
    // Real QueryClient — reportStopped drives the optimistic cache
    // update + invalidation. Mocking each cache method individually
    // is more brittle than just instantiating a real client.
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  };
});

vi.mock("@/services/query/storage", async () => {
  const { mockStore } = await hoisted;
  return {
    storage: {
      getString: (key: string) => mockStore.get(key),
      set: (key: string, value: string) => mockStore.set(key, value),
      remove: (key: string) => mockStore.delete(key),
      getAllKeys: () => [...mockStore.keys()],
    },
  };
});

vi.mock("@/services/api/client", async () => {
  const { mockFetch } = await hoisted;
  return { apiFetchAuthenticated: (...args: unknown[]) => mockFetch(...args) };
});

vi.mock("@/services/query", async () => {
  const { queryClient } = await hoisted;
  return { queryClient };
});

const { mockStore, mockFetch, queryClient } = await hoisted;

// eslint-disable-next-line import/first
import { reportStart, reportProgress, reportStopped, replayReport } from "./reporter";
// eslint-disable-next-line import/first
import { peekCount } from "./pending-store";
// eslint-disable-next-line import/first
import { queryKeys } from "@jellyfuse/query-keys";

beforeEach(() => {
  mockStore.clear();
  mockFetch.mockReset();
  queryClient.clear();
});

afterEach(() => {
  // belt-and-suspenders for any test that mutates queryClient outside beforeEach
  queryClient.clear();
});

const baseArgs = {
  baseUrl: "https://jf.test",
  itemId: "item-abc",
  mediaSourceId: "src-1",
  playSessionId: "sess-1",
} as const;

const stoppedArgs = {
  ...baseArgs,
  positionTicks: 72_000_000_000,
  runtimeTicks: 0,
  userId: "user-1",
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

    await reportStopped(stoppedArgs);

    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://jf.test/Sessions/Playing/Stopped");

    const body = JSON.parse(init.body);
    expect(body.ItemId).toBe("item-abc");
    expect(body.PositionTicks).toBe(72_000_000_000);
    expect(body.CanSeek).toBeUndefined(); // stopped doesn't need CanSeek
  });

  it("optimistically patches the detail cache", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    queryClient.setQueryData(queryKeys.movieDetail("user-1", "item-abc"), {
      id: { kind: "jellyfin", jellyfinId: "item-abc" },
      userData: undefined,
    });

    // 30 min of a 2 h runtime → 25 % played (well below the 90 %
    // threshold) so the position is preserved on the optimistic patch.
    const positionTicks = 30 * 60 * 10_000_000;
    const runtimeTicks = 120 * 60 * 10_000_000;
    await reportStopped({ ...stoppedArgs, positionTicks, runtimeTicks });

    const detail = queryClient.getQueryData<{ userData?: { playbackPositionTicks: number } }>(
      queryKeys.movieDetail("user-1", "item-abc"),
    );
    expect(detail?.userData?.playbackPositionTicks).toBe(positionTicks);
  });

  it("invalidates home + detail on a successful POST", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await reportStopped(stoppedArgs);

    const calls = invalidateSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ queryKey: ["home"], exact: false });
    expect(calls).toContainEqual({ queryKey: queryKeys.movieDetail("user-1", "item-abc") });
    expect(calls).toContainEqual({ queryKey: queryKeys.seriesDetail("user-1", "item-abc") });
    invalidateSpy.mockRestore();
  });

  it("does not invalidate when the report was enqueued", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await reportStopped(stoppedArgs);

    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(peekCount()).toBe(1);
    invalidateSpy.mockRestore();
  });

  it("persists runtimeTicks + userId on the queued report", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    await reportStopped({ ...stoppedArgs, runtimeTicks: 60_000_000_000 });

    const raw = [...mockStore.values()][0];
    expect(raw).toBeDefined();
    const stored = JSON.parse(raw!);
    expect(stored.runtimeTicks).toBe(60_000_000_000);
    expect(stored.userId).toBe("user-1");
  });
});

describe("replayReport", () => {
  it("invalidates home on a successful stopped replay", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await replayReport("https://jf.test", {
      itemId: "item-abc",
      mediaSourceId: "src-1",
      playSessionId: "sess-1",
      runtimeTicks: 60_000_000_000,
      userId: "user-1",
      kind: { type: "stopped", positionTicks: 30_000_000_000 },
      occurredAtMs: 1_700_000_000_000,
    });

    expect(invalidateSpy.mock.calls.map((c) => c[0])).toContainEqual({
      queryKey: ["home"],
      exact: false,
    });
    invalidateSpy.mockRestore();
  });

  it("does not invalidate on a successful start/progress replay", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await replayReport("https://jf.test", {
      itemId: "item-abc",
      mediaSourceId: "src-1",
      playSessionId: "sess-1",
      kind: { type: "progress", positionTicks: 0, isPaused: false, playMethod: "DirectPlay" },
      occurredAtMs: 1_700_000_000_000,
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
    invalidateSpy.mockRestore();
  });
});

describe("known-offline short-circuit", () => {
  it("skips fetch and enqueues when the connection monitor has errored", async () => {
    // Drive the system-info query into an errored state via a failing
    // queryFn — same shape the connection monitor produces in
    // production. The reporter reads `getQueryState(...).status === "error"`
    // and short-circuits to the queue.
    await queryClient
      .fetchQuery({
        queryKey: queryKeys.systemInfo("https://jf.test"),
        queryFn: () => Promise.reject(new Error("offline")),
        retry: false,
      })
      .catch(() => {});

    await reportStart({ ...baseArgs, positionTicks: 0, playMethod: "DirectPlay" });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(peekCount()).toBe(1);
  });

  it("still tries the network when the ping status is unknown or success", async () => {
    queryClient.setQueryData(queryKeys.systemInfo("https://jf.test"), { ok: true });
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    await reportStart({ ...baseArgs, positionTicks: 0, playMethod: "DirectPlay" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(peekCount()).toBe(0);
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
