import type { AuthContext, AuthenticatedUser } from "@jellyfuse/api";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { getDeviceId } from "@/services/device-id";

/**
 * Build a pre-auth `AuthContext` (no token yet). Used by
 * `authenticateByName` during sign-in, when we need to send the device
 * id in the header before we have a user token.
 *
 * `clientName` and `clientVersion` feed the Jellyfin device-management
 * screen so the user sees "Jellyfuse 0.0.0" when listing their sessions
 * on the server. `deviceName` is the human-readable hardware name
 * (e.g. "iPhone 15 Pro").
 */
export async function buildPreAuthContext(): Promise<Omit<AuthContext, "token">> {
  return {
    deviceId: await getDeviceId(),
    clientName: "Jellyfuse",
    clientVersion: Constants.expoConfig?.version ?? "0.0.0",
    deviceName: Device.modelName ?? Device.deviceName ?? "Unknown Device",
  };
}

/**
 * Build a full `AuthContext` for an already-authenticated user.
 * Fed into `setCurrentAuthContext` by `AuthProvider` so that
 * `apiFetchAuthenticated` can serve every call from the active user
 * without re-reading state.
 */
export async function buildAuthContextForUser(user: AuthenticatedUser): Promise<AuthContext> {
  const pre = await buildPreAuthContext();
  return { ...pre, token: user.token };
}
