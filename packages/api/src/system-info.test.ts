import { describe, expect, it, vi } from "vitest";
import {
  getSystemInfoPublic,
  SystemInfoHttpError,
  SystemInfoParseError,
  type FetchLike,
} from "./system-info";

const rawOk = {
  ServerName: "my-jellyfin",
  ProductName: "Jellyfin Server",
  Version: "10.9.11",
  Id: "abcdef123456",
};

function fakeFetcher(
  response: {
    ok?: boolean;
    status?: number;
    body?: unknown;
  } = {},
): FetchLike {
  return vi.fn(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.body ?? rawOk,
  }));
}

describe("getSystemInfoPublic", () => {
  it("normalises PascalCase server response to camelCase domain type", async () => {
    const info = await getSystemInfoPublic("https://jellyfin.example.com", fakeFetcher());
    expect(info).toEqual({
      serverName: "my-jellyfin",
      productName: "Jellyfin Server",
      version: "10.9.11",
      id: "abcdef123456",
    });
  });

  it("joins base URL with a trailing slash", async () => {
    const fetcher = fakeFetcher();
    await getSystemInfoPublic("https://jellyfin.example.com/", fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "https://jellyfin.example.com/System/Info/Public",
      undefined,
    );
  });

  it("joins base URL without a trailing slash", async () => {
    const fetcher = fakeFetcher();
    await getSystemInfoPublic("https://jellyfin.example.com", fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      "https://jellyfin.example.com/System/Info/Public",
      undefined,
    );
  });

  it("forwards an AbortSignal when provided", async () => {
    const fetcher = fakeFetcher();
    const controller = new AbortController();
    await getSystemInfoPublic("https://jf", fetcher, controller.signal);
    expect(fetcher).toHaveBeenCalledWith("https://jf/System/Info/Public", {
      signal: controller.signal,
    });
  });

  it("throws SystemInfoHttpError on non-2xx", async () => {
    const fetcher = fakeFetcher({ ok: false, status: 503 });
    await expect(getSystemInfoPublic("https://jf", fetcher)).rejects.toBeInstanceOf(
      SystemInfoHttpError,
    );
  });

  it("throws SystemInfoParseError on unexpected payload", async () => {
    const fetcher = fakeFetcher({ body: { nope: true } });
    await expect(getSystemInfoPublic("https://jf", fetcher)).rejects.toBeInstanceOf(
      SystemInfoParseError,
    );
  });
});
