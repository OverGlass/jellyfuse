// Jellyfin `X-Emby-Authorization` header builder. Separated into its own
// module so both `./index` (public re-export) and `./authenticate` (direct
// use) can import it without forming a require cycle through the barrel.

export interface AuthContext {
  /** Stable device id from `services/device-id`, never random-per-session. */
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
