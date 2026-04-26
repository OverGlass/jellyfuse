import { describe, expect, it, vi } from "vitest";
import {
  markItemPlayed,
  unmarkItemPlayed,
  UserItemHttpError,
  type MarkItemPlayedArgs,
} from "./user-items";

const baseArgs: MarkItemPlayedArgs = {
  baseUrl: "https://jellyfin.example.com",
  userId: "user-xyz",
  itemId: "item-abc",
};

function okFetcher() {
  return vi.fn().mockResolvedValue({ ok: true, status: 204 });
}

describe("markItemPlayed", () => {
  it("POSTs to /Users/{userId}/PlayedItems/{itemId}", async () => {
    const fetcher = okFetcher();
    await markItemPlayed(baseArgs, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://jellyfin.example.com/Users/user-xyz/PlayedItems/item-abc");
    expect(init).toMatchObject({ method: "POST" });
  });

  it("URL-encodes path segments", async () => {
    const fetcher = okFetcher();
    await markItemPlayed(
      { baseUrl: "https://jellyfin.example.com", userId: "u/1", itemId: "i 1" },
      fetcher,
    );
    const [url] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://jellyfin.example.com/Users/u%2F1/PlayedItems/i%201");
  });

  it("strips a trailing slash from the base URL", async () => {
    const fetcher = okFetcher();
    await markItemPlayed({ ...baseArgs, baseUrl: "https://jellyfin.example.com/" }, fetcher);
    const [url] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://jellyfin.example.com/Users/user-xyz/PlayedItems/item-abc");
  });

  it("forwards the abort signal", async () => {
    const fetcher = okFetcher();
    const ctrl = new AbortController();
    await markItemPlayed(baseArgs, fetcher, ctrl.signal);
    const [, init] = fetcher.mock.calls[0]!;
    expect(init.signal).toBe(ctrl.signal);
  });

  it("throws UserItemHttpError on a non-2xx response", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(markItemPlayed(baseArgs, fetcher)).rejects.toBeInstanceOf(UserItemHttpError);
  });
});

describe("unmarkItemPlayed", () => {
  it("DELETEs to /Users/{userId}/PlayedItems/{itemId}", async () => {
    const fetcher = okFetcher();
    await unmarkItemPlayed(baseArgs, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://jellyfin.example.com/Users/user-xyz/PlayedItems/item-abc");
    expect(init).toMatchObject({ method: "DELETE" });
  });

  it("throws UserItemHttpError on a non-2xx response", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(unmarkItemPlayed(baseArgs, fetcher)).rejects.toBeInstanceOf(UserItemHttpError);
  });
});
