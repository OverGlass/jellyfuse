import { describe, expect, it, vi } from "vitest";
import {
  authenticateByName,
  AuthenticateHttpError,
  AuthenticateParseError,
  type AuthenticateInput,
} from "./authenticate";

const baseInput: AuthenticateInput = {
  baseUrl: "https://jellyfin.example.com",
  username: "alice",
  password: "hunter2",
  authContext: {
    deviceId: "device-abc",
    clientName: "Jellyfuse",
    clientVersion: "0.0.0",
    deviceName: "iPhone 15 Pro",
  },
};

const rawOk = {
  User: { Id: "user-xyz", Name: "alice" },
  AccessToken: "tok-123",
};

function fakeFetcher(
  response: {
    ok?: boolean;
    status?: number;
    body?: unknown;
  } = {},
): any {
  return vi.fn(async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.body ?? rawOk,
  }));
}

describe("authenticateByName", () => {
  it("posts credentials and returns the authenticated user", async () => {
    const fetcher = fakeFetcher();
    const result = await authenticateByName(baseInput, fetcher);
    expect(result).toEqual({
      userId: "user-xyz",
      displayName: "alice",
      token: "tok-123",
    });
  });

  it("sends username and password as JSON Username / Pw fields", async () => {
    const fetcher = fakeFetcher();
    await authenticateByName(baseInput, fetcher);
    const init = fetcher.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ Username: "alice", Pw: "hunter2" });
  });

  it("includes the X-Emby-Authorization header with device id (no token yet)", async () => {
    const fetcher = fakeFetcher();
    await authenticateByName(baseInput, fetcher);
    const header = fetcher.mock.calls[0][1].headers["X-Emby-Authorization"] as string;
    expect(header).toContain('DeviceId="device-abc"');
    expect(header).toContain('Client="Jellyfuse"');
    expect(header).not.toContain("Token=");
  });

  it("joins the endpoint path to the base URL regardless of trailing slash", async () => {
    const fetcher = fakeFetcher();
    await authenticateByName({ ...baseInput, baseUrl: "https://jellyfin.example.com/" }, fetcher);
    expect(fetcher.mock.calls[0][0]).toBe("https://jellyfin.example.com/Users/AuthenticateByName");
  });

  it("throws AuthenticateHttpError on 401", async () => {
    const fetcher = fakeFetcher({ ok: false, status: 401 });
    await expect(authenticateByName(baseInput, fetcher)).rejects.toBeInstanceOf(
      AuthenticateHttpError,
    );
  });

  it("throws AuthenticateParseError on unexpected payload", async () => {
    const fetcher = fakeFetcher({ body: { wrong: true } });
    await expect(authenticateByName(baseInput, fetcher)).rejects.toBeInstanceOf(
      AuthenticateParseError,
    );
  });
});
