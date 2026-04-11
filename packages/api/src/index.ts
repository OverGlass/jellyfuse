// @jellyfuse/api — pure TS Jellyfin + Jellyseerr HTTP clients.
// No classes with state, no business logic, no persistence. Every call is a
// pure function taking an ApiClient (injected at the call site). Uses Nitro
// Fetch in the app; uses the platform `fetch` in tests.
//
// Phase 0a ships the ApiClient skeleton + auth_headers port. Phase 1 ports
// every endpoint surface used by the Rust crate jf-api.

export interface AuthContext {
  /** Stable device id from the `device-id` Nitro module, never random-per-session. */
  deviceId: string;
  /** Authenticated user token, or undefined pre-login. */
  token: string | undefined;
  /** Client name + version, used in the X-Emby-Authorization header. */
  clientName: string;
  clientVersion: string;
  deviceName: string;
}

/**
 * Port of `auth_headers()` in crates/jf-api/src/jellyfin.rs:231.
 * Builds the `X-Emby-Authorization` header from an AuthContext.
 */
export function buildAuthHeader(ctx: AuthContext): string {
  const parts = [
    `MediaBrowser Client="${escape(ctx.clientName)}"`,
    `Device="${escape(ctx.deviceName)}"`,
    `DeviceId="${escape(ctx.deviceId)}"`,
    `Version="${escape(ctx.clientVersion)}"`,
  ];
  if (ctx.token) parts.push(`Token="${escape(ctx.token)}"`);
  return parts.join(", ");
}

function escape(value: string): string {
  // Jellyfin header values are quoted; escape embedded quotes and backslashes.
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export * from "./system-info";
export * from "./authenticate";
