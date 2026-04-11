import { describe, expect, it, vi } from "vitest";
import {
  extractConnectSid,
  JellyseerrHttpError,
  jellyseerrLogin,
  type JellyseerrLoginInput,
} from "./jellyseerr";

const baseInput: JellyseerrLoginInput = {
  baseUrl: "https://jellyseerr.example.com",
  username: "alice",
  password: "hunter2",
};

interface FakeResponse {
  ok: boolean;
  status: number;
  body: unknown;
  setCookie: string | null;
}

function fakeFetcher(response: Partial<FakeResponse> = {}) {
  return vi.fn(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.body ?? {},
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "set-cookie" ? (response.setCookie ?? null) : null,
    },
  }));
}

describe("jellyseerrLogin", () => {
  it("returns the connect.sid cookie value on success", async () => {
    const fetcher = fakeFetcher({
      setCookie:
        "connect.sid=s%3AabcDEF123.veryLongSignature; Path=/; HttpOnly; Secure; SameSite=Lax",
    });
    const result = await jellyseerrLogin(baseInput, fetcher as never);
    expect(result.cookie).toBe("s%3AabcDEF123.veryLongSignature");
  });

  it("posts the username and password as JSON", async () => {
    const fetcher = fakeFetcher({ setCookie: "connect.sid=short.sig; Path=/" });
    await jellyseerrLogin(baseInput, fetcher as never);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe("https://jellyseerr.example.com/api/v1/auth/jellyfin");
    expect(init["method"]).toBe("POST");
    const headers = init["headers"] as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init["body"] as string)).toEqual({
      username: "alice",
      password: "hunter2",
    });
  });

  it("joins the endpoint path regardless of trailing slash", async () => {
    const fetcher = fakeFetcher({ setCookie: "connect.sid=s.x; Path=/" });
    await jellyseerrLogin(
      { ...baseInput, baseUrl: "https://jellyseerr.example.com/" },
      fetcher as never,
    );
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://jellyseerr.example.com/api/v1/auth/jellyfin");
  });

  it("throws JellyseerrHttpError on 401", async () => {
    const fetcher = fakeFetcher({ ok: false, status: 401 });
    await expect(jellyseerrLogin(baseInput, fetcher as never)).rejects.toBeInstanceOf(
      JellyseerrHttpError,
    );
  });

  it("returns cookie: null when Set-Cookie is missing (caller falls back to native jar)", async () => {
    const fetcher = fakeFetcher({ setCookie: null });
    const result = await jellyseerrLogin(baseInput, fetcher as never);
    expect(result.cookie).toBeNull();
  });

  it("returns cookie: null when Set-Cookie has no connect.sid", async () => {
    const fetcher = fakeFetcher({
      setCookie: "other=value; Path=/, another=thing; Path=/",
    });
    const result = await jellyseerrLogin(baseInput, fetcher as never);
    expect(result.cookie).toBeNull();
  });
});

describe("extractConnectSid", () => {
  it("returns undefined for null", () => {
    expect(extractConnectSid(null)).toBeUndefined();
  });

  it("returns undefined for empty", () => {
    expect(extractConnectSid("")).toBeUndefined();
  });

  it("extracts from a single Set-Cookie line", () => {
    expect(extractConnectSid("connect.sid=s%3Asig; Path=/; HttpOnly")).toBe("s%3Asig");
  });

  it("extracts from multiple Set-Cookie headers merged by the Fetch spec (comma-joined)", () => {
    const merged = "other=v; Path=/, connect.sid=s%3Abig.sig; Path=/; HttpOnly";
    expect(extractConnectSid(merged)).toBe("s%3Abig.sig");
  });

  it("handles connect.sid at the start of the merged header", () => {
    const merged = "connect.sid=first; Path=/, tail=2; Path=/";
    expect(extractConnectSid(merged)).toBe("first");
  });
});
