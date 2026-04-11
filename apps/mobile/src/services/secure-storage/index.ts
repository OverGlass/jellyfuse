import * as SecureStore from "expo-secure-store";

/**
 * Thin wrapper around `expo-secure-store` (Keychain on iOS/Mac Catalyst,
 * AES-256-GCM under the Android Keystore). The wrapper owns the call-site
 * ABI so any future swap to a custom Nitro module is a two-file change —
 * nothing in the app imports `expo-secure-store` directly.
 *
 * Keys are namespaced with `jellyfuse.` to avoid collisions with any other
 * app sharing a keychain group on Apple (shared App Group containers land
 * in Phase 10 for widgets).
 *
 * Multi-user shape (Phase 1b.1 — ARK-6):
 * - `jellyfinUsers` holds the entire `AuthenticatedUser[]` serialised as
 *   JSON. There is no separate per-user key; the array is the source of
 *   truth. Mirrors the Rust `authenticated_users` sled tree at
 *   `crates/jf-desktop/src/settings.rs:76-100`.
 * - `jellyfinActiveUserId` points at the currently active user. A
 *   dangling id (user removed) is treated as "no active user".
 * - `jellyseerrCookie` is a single string, global to the app — Jellyseerr
 *   sessions are not per-user (see memory: project_jellyfuse_auth_architecture).
 */

const KEY_PREFIX = "jellyfuse.";

export const SecureStorageKey = {
  jellyfinServerUrl: `${KEY_PREFIX}jellyfin.serverUrl`,
  jellyfinServerVersion: `${KEY_PREFIX}jellyfin.serverVersion`,
  jellyfinUsers: `${KEY_PREFIX}jellyfin.users`,
  jellyfinActiveUserId: `${KEY_PREFIX}jellyfin.activeUserId`,
  jellyseerrUrl: `${KEY_PREFIX}jellyseerr.url`,
  jellyseerrCookie: `${KEY_PREFIX}jellyseerr.cookie`,
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

/** Remove every Jellyfuse-owned secure-storage entry. Used on sign-out-all. */
export async function clearSecureStorage(): Promise<void> {
  await Promise.all(Object.values(SecureStorageKey).map((key) => SecureStore.deleteItemAsync(key)));
}
