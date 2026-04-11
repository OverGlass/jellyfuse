import type { AuthenticatedUser } from "@jellyfuse/api";
import { findUserById } from "./users";

/**
 * Shape of the React Query cache entry at `['auth', 'persisted']`.
 * Lives in its own module so both the `AuthProvider` (React-side) and
 * the `services/api/client.ts` module (out-of-React fetcher) can
 * import the type + key without forming a cycle.
 */

export interface PersistedAuth {
  serverUrl: string | undefined;
  serverVersion: string | undefined;
  users: AuthenticatedUser[];
  activeUserId: string | undefined;
  jellyseerrUrl: string | undefined;
}

export const PERSISTED_AUTH_KEY = ["auth", "persisted"] as const;

export const EMPTY_PERSISTED_AUTH: PersistedAuth = {
  serverUrl: undefined,
  serverVersion: undefined,
  users: [],
  activeUserId: undefined,
  jellyseerrUrl: undefined,
};

/** Resolve the active user from a (possibly undefined) cache snapshot. */
export function findActiveUser(
  persisted: PersistedAuth | undefined,
): AuthenticatedUser | undefined {
  if (!persisted) return undefined;
  return findUserById(persisted.users, persisted.activeUserId);
}
