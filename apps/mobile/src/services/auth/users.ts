import type { AuthenticatedUser } from "@jellyfuse/api";
import {
  getSecureItem,
  removeSecureItem,
  SecureStorageKey,
  setSecureItem,
} from "@/services/secure-storage";

/**
 * Multi-user persistence for Jellyfin accounts on one server. Mirrors the
 * Rust load/save helpers in `crates/jf-desktop/src/settings.rs:76-100`.
 *
 * The CRUD layer is injectable via a `UserStorage` adapter so Jest/Vitest
 * tests can construct an in-memory fake, and the app gets a real
 * secure-storage-backed singleton for free.
 */

export interface UserStorage {
  loadUsers(): Promise<AuthenticatedUser[]>;
  saveUsers(users: AuthenticatedUser[]): Promise<void>;
  loadActiveUserId(): Promise<string | undefined>;
  saveActiveUserId(id: string | undefined): Promise<void>;
}

/**
 * Insert-or-replace a user by `userId`. Matches the Rust behaviour:
 * if an entry with the same id already exists, the new record wins
 * (useful after a password change or when the Jellyfin token rotates).
 */
export async function upsertUser(
  storage: UserStorage,
  user: AuthenticatedUser,
): Promise<AuthenticatedUser[]> {
  const users = await storage.loadUsers();
  const idx = users.findIndex((u) => u.userId === user.userId);
  if (idx >= 0) {
    users[idx] = user;
  } else {
    users.push(user);
  }
  await storage.saveUsers(users);
  return users;
}

/**
 * Remove by userId. Returns the updated list and a reference to the new
 * active user id (the caller must decide whether to hand this back to
 * `saveActiveUserId` — for instance, the auth reducer handles that when
 * the removed user was the active one).
 */
export async function removeUserById(
  storage: UserStorage,
  userId: string,
): Promise<{ users: AuthenticatedUser[]; nextActiveUserId: string | undefined }> {
  const users = (await storage.loadUsers()).filter((u) => u.userId !== userId);
  await storage.saveUsers(users);
  const activeId = await storage.loadActiveUserId();
  const nextActiveUserId = activeId === userId ? (users[0]?.userId ?? undefined) : activeId;
  if (nextActiveUserId !== activeId) {
    await storage.saveActiveUserId(nextActiveUserId);
  }
  return { users, nextActiveUserId };
}

export function findUserById(
  users: AuthenticatedUser[],
  userId: string | undefined,
): AuthenticatedUser | undefined {
  if (!userId) return undefined;
  return users.find((u) => u.userId === userId);
}

/**
 * Secure-storage-backed `UserStorage` used by the real `AuthProvider`.
 * Serialisation is plain JSON — MMKV-esque binary formats would be
 * overkill for the handful of bytes per user.
 */
export const secureUserStorage: UserStorage = {
  loadUsers: async () => {
    const raw = await getSecureItem(SecureStorageKey.jellyfinUsers);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isAuthenticatedUser);
    } catch {
      // Corrupt payload — start fresh rather than crash the app on boot.
      return [];
    }
  },
  saveUsers: async (users) => {
    if (users.length === 0) {
      await removeSecureItem(SecureStorageKey.jellyfinUsers);
      return;
    }
    await setSecureItem(SecureStorageKey.jellyfinUsers, JSON.stringify(users));
  },
  loadActiveUserId: () => getSecureItem(SecureStorageKey.jellyfinActiveUserId),
  saveActiveUserId: async (id) => {
    if (!id) {
      await removeSecureItem(SecureStorageKey.jellyfinActiveUserId);
      return;
    }
    await setSecureItem(SecureStorageKey.jellyfinActiveUserId, id);
  },
};

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["userId"] === "string" &&
    typeof v["displayName"] === "string" &&
    typeof v["token"] === "string" &&
    (v["avatarUrl"] === undefined || typeof v["avatarUrl"] === "string")
  );
}
