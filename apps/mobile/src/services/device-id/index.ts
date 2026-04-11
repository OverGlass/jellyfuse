import * as Application from "expo-application";
import { Platform } from "react-native";
import { getSecureItem, setSecureItem, SecureStorageKey } from "@/services/secure-storage";

/**
 * Returns a stable device id for Jellyfin's `X-Emby-Authorization` header.
 *
 * Prefers OS-provided ids where available:
 * - iOS / Mac Catalyst: `identifierForVendor` via expo-application — stable
 *   across launches and reinstalls within the same vendor, resets only if
 *   every app from the vendor is uninstalled.
 * - Android: `Settings.Secure.ANDROID_ID` via expo-application — stable
 *   across reinstalls on Android 8+, scoped to the signing key.
 *
 * Falls back to a self-generated UUID persisted in secure-storage if the
 * OS call returns null (edge case on simulators or jailbroken devices).
 *
 * The rule from CLAUDE.md is "never generate random per-session". Once
 * fetched (OS or fallback), the id is memoised in-memory for the process
 * lifetime so every HTTP request sees the same value.
 */
let memoisedDeviceId: string | undefined;

export async function getDeviceId(): Promise<string> {
  if (memoisedDeviceId) return memoisedDeviceId;

  const osProvided = await getOsDeviceId();
  if (osProvided) {
    memoisedDeviceId = osProvided;
    return osProvided;
  }

  // OS call returned null (rare — usually a misconfigured simulator).
  // Fall back to a self-generated UUID persisted in secure-storage so
  // the id at least survives the process restart.
  const existing = await getSecureItem(SecureStorageKey.deviceId);
  if (existing) {
    memoisedDeviceId = existing;
    return existing;
  }
  const generated = globalThis.crypto.randomUUID();
  await setSecureItem(SecureStorageKey.deviceId, generated);
  memoisedDeviceId = generated;
  return generated;
}

async function getOsDeviceId(): Promise<string | null> {
  if (Platform.OS === "ios") {
    return await Application.getIosIdForVendorAsync();
  }
  if (Platform.OS === "android") {
    return Application.getAndroidId();
  }
  return null;
}

/** Test / recovery helper. Not exported from the service barrel. */
export function __resetDeviceIdCache(): void {
  memoisedDeviceId = undefined;
}
