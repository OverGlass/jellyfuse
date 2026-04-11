import * as SecureStore from "expo-secure-store";

/**
 * Thin wrapper around `expo-secure-store` (Keychain on iOS/Mac Catalyst,
 * AES-256-GCM under the Android Keystore). The wrapper owns the call-site
 * ABI so any future swap to a custom Nitro module is a two-file change —
 * nothing in the app imports `expo-secure-store` directly.
 *
 * The underlying keys are namespaced with `jellyfuse.` to avoid collisions
 * with any other app that might share the keychain group on Apple (shared
 * App Group containers land in Phase 10 for widgets).
 */

const KEY_PREFIX = "jellyfuse.";

/** Canonical secure-storage keys used across the app. */
export const SecureStorageKey = {
  authToken: `${KEY_PREFIX}auth.token`,
  authUserId: `${KEY_PREFIX}auth.userId`,
  authUserName: `${KEY_PREFIX}auth.userName`,
  authServerUrl: `${KEY_PREFIX}auth.serverUrl`,
  deviceId: `${KEY_PREFIX}device.id`,
} as const;

export type SecureStorageKey = (typeof SecureStorageKey)[keyof typeof SecureStorageKey];

/** Read a value, or `undefined` if the key is not set. */
export async function getSecureItem(key: SecureStorageKey): Promise<string | undefined> {
  const value = await SecureStore.getItemAsync(key);
  return value ?? undefined;
}

/** Write a value. Overwrites existing values silently. */
export async function setSecureItem(key: SecureStorageKey, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

/** Delete a value. No-op if the key was already absent. */
export async function removeSecureItem(key: SecureStorageKey): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

/** Remove every Jellyfuse-owned secure-storage entry. Used on sign-out. */
export async function clearSecureStorage(): Promise<void> {
  await Promise.all(Object.values(SecureStorageKey).map((key) => SecureStore.deleteItemAsync(key)));
}
