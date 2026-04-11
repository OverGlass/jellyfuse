import { authenticateByName, jellyseerrLogin, type AuthenticatedUser } from "@jellyfuse/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { apiFetch, setCurrentAuthContext } from "@/services/api/client";
import { setCurrentJellyseerrCookie } from "@/services/jellyseerr/client";
import {
  clearSecureStorage,
  getSecureItem,
  removeSecureItem,
  SecureStorageKey,
  setSecureItem,
} from "@/services/secure-storage";
import { buildAuthContextForUser, buildPreAuthContext } from "./auth-context-builder";
import { findUserById, removeUserById, secureUserStorage, upsertUser } from "./users";

/**
 * Multi-user auth state for Jellyfuse. Ports the Rust model from
 * `crates/jf-core/src/state.rs` + `crates/jf-core/src/models.rs`
 * (Settings + authenticated_users sled tree) into a React Query cache.
 *
 * **No async useEffects** per the project rule (see memory:
 * `feedback_no_async_useeffect` and the React docs page
 * https://react.dev/learn/you-might-not-need-an-effect). Every bit of
 * async work — hydrating from secure-storage, building the auth
 * context via expo-application, calling `authenticateByName` /
 * `jellyseerrLogin`, persisting users — runs through React Query.
 * The cache at `['auth', 'persisted']` is the single source of truth
 * for the persisted shape; mutations write to secure-storage and then
 * `setQueryData` the new shape back. `useEffect` is used only for
 * synchronous ref-pushes that can't be expressed as derived state
 * (module-level fetchers outside React).
 *
 * Per-user Jellyseerr cookie: the cookie lives on `AuthenticatedUser`
 * because different Jellyfin users can have different Jellyseerr
 * permissions. See memory: `project_jellyfuse_auth_architecture`.
 */

export type AuthStatus = "loading" | "unauthenticated" | "authenticated";

/** Whether the Jellyseerr side of the session is usable right now. */
export type JellyseerrStatus =
  | "not-configured" // no URL set
  | "connected" // URL set + cookie present on the active user
  | "disconnected"; // URL set but no valid cookie for the active user

export class AuthServerNotConfiguredError extends Error {
  constructor() {
    super("Cannot sign in before a server URL has been configured");
    this.name = "AuthServerNotConfiguredError";
  }
}

export interface AuthState {
  status: AuthStatus;
  serverUrl: string | undefined;
  serverVersion: string | undefined;
  users: AuthenticatedUser[];
  activeUser: AuthenticatedUser | undefined;
  jellyseerrUrl: string | undefined;
  jellyseerrStatus: JellyseerrStatus;

  setServer: (args: {
    url: string;
    version: string | undefined;
    jellyseerrUrl: string | undefined;
  }) => Promise<void>;
  /** Authenticate + upsert + set active user, then (optionally) log in to Jellyseerr. */
  signInWithCredentials: (input: { username: string; password: string }) => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
  signOutAll: () => Promise<void>;
}

/**
 * Persisted auth snapshot cached under `['auth', 'persisted']`. Reflects
 * exactly what's currently in secure-storage — every mutation updates
 * the cache with `setQueryData` so consumers see the change without a
 * refetch.
 */
interface PersistedAuth {
  serverUrl: string | undefined;
  serverVersion: string | undefined;
  users: AuthenticatedUser[];
  activeUserId: string | undefined;
  jellyseerrUrl: string | undefined;
}

const PERSISTED_AUTH_KEY = ["auth", "persisted"] as const;

const EMPTY_PERSISTED_AUTH: PersistedAuth = {
  serverUrl: undefined,
  serverVersion: undefined,
  users: [],
  activeUserId: undefined,
  jellyseerrUrl: undefined,
};

async function loadPersistedAuth(): Promise<PersistedAuth> {
  const [serverUrl, serverVersion, activeUserId, jellyseerrUrl, users] = await Promise.all([
    getSecureItem(SecureStorageKey.jellyfinServerUrl),
    getSecureItem(SecureStorageKey.jellyfinServerVersion),
    getSecureItem(SecureStorageKey.jellyfinActiveUserId),
    getSecureItem(SecureStorageKey.jellyseerrUrl),
    secureUserStorage.loadUsers(),
  ]);
  // Drop a dangling active pointer (user removed from the list).
  const hasActive = activeUserId !== undefined && users.some((u) => u.userId === activeUserId);
  return {
    serverUrl,
    serverVersion,
    users,
    activeUserId: hasActive ? activeUserId : undefined,
    jellyseerrUrl,
  };
}

const AuthContext = createContext<AuthState | null>(null);

interface Props {
  children: ReactNode;
}

/**
 * Wraps the app in the AuthContext. Does no async work itself — the
 * actual queries + mutations live in `useAuthInternal` which is
 * evaluated inside this component and then forwarded through the
 * context to every consumer.
 */
export function AuthProvider({ children }: Props) {
  const value = useAuthInternal();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * The real query/mutation plumbing. Separated from `AuthProvider` only
 * to keep the latter trivially `<Provider>{children}</Provider>`.
 */
function useAuthInternal(): AuthState {
  const queryClient = useQueryClient();

  // ------------------------------------------------------------------
  // Hydration query — reads secure-storage once and caches forever.
  // ------------------------------------------------------------------
  const persistedQuery = useQuery({
    queryKey: PERSISTED_AUTH_KEY,
    queryFn: loadPersistedAuth,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });

  const persisted = persistedQuery.data ?? EMPTY_PERSISTED_AUTH;
  const activeUser = findUserById(persisted.users, persisted.activeUserId);

  // ------------------------------------------------------------------
  // Auth-context query — derives the `AuthContext` (device id, client
  // version, device name, token) for the active user. Re-keyed by
  // userId so a user switch automatically triggers a rebuild.
  // ------------------------------------------------------------------
  const contextQuery = useQuery({
    queryKey: ["auth", "context", activeUser?.userId ?? "anon"] as const,
    queryFn: () => (activeUser ? buildAuthContextForUser(activeUser) : null),
    enabled: Boolean(activeUser),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });

  // ------------------------------------------------------------------
  // Synchronous ref-pushes — these are the only useEffects in the
  // module, and both are *sync* bodies (no async/await). They publish
  // derived state into module-level refs so `apiFetchAuthenticated`
  // and `jellyseerrFetch` can read the current value outside React.
  // ------------------------------------------------------------------
  useEffect(() => {
    setCurrentAuthContext(contextQuery.data ?? undefined);
  }, [contextQuery.data]);

  useEffect(() => {
    setCurrentJellyseerrCookie(activeUser?.jellyseerrCookie);
  }, [activeUser?.jellyseerrCookie]);

  // ------------------------------------------------------------------
  // Mutations — each reads the current persisted cache, mutates
  // secure-storage, and writes the new cache via `setQueryData`.
  // Consumers get an awaitable function via `mutateAsync`.
  // ------------------------------------------------------------------

  const setServerMutation = useMutation({
    mutationFn: async ({
      url,
      version,
      jellyseerrUrl,
    }: {
      url: string;
      version: string | undefined;
      jellyseerrUrl: string | undefined;
    }): Promise<PersistedAuth> => {
      const current =
        queryClient.getQueryData<PersistedAuth>(PERSISTED_AUTH_KEY) ?? EMPTY_PERSISTED_AUTH;

      await setSecureItem(SecureStorageKey.jellyfinServerUrl, url);
      if (version) {
        await setSecureItem(SecureStorageKey.jellyfinServerVersion, version);
      } else {
        await removeSecureItem(SecureStorageKey.jellyfinServerVersion);
      }
      if (jellyseerrUrl) {
        await setSecureItem(SecureStorageKey.jellyseerrUrl, jellyseerrUrl);
      } else {
        await removeSecureItem(SecureStorageKey.jellyseerrUrl);
      }

      // If the Jellyseerr URL changed, every stored cookie is now
      // pointing at a stale/invalid session — drop them from every
      // user record so `jellyseerrFetch` stops sending them.
      const urlChanged = jellyseerrUrl !== current.jellyseerrUrl;
      let users = current.users;
      if (urlChanged && users.some((u) => u.jellyseerrCookie !== undefined)) {
        users = users.map(({ jellyseerrCookie: _drop, ...rest }) => rest);
        await secureUserStorage.saveUsers(users);
      }

      return {
        ...current,
        serverUrl: url,
        serverVersion: version,
        jellyseerrUrl,
        users,
      };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PERSISTED_AUTH_KEY, data);
    },
  });

  const signInMutation = useMutation({
    mutationFn: async (input: { username: string; password: string }): Promise<PersistedAuth> => {
      const current =
        queryClient.getQueryData<PersistedAuth>(PERSISTED_AUTH_KEY) ?? EMPTY_PERSISTED_AUTH;
      const { serverUrl, jellyseerrUrl } = current;
      if (!serverUrl) {
        throw new AuthServerNotConfiguredError();
      }

      const authContext = await buildPreAuthContext();
      const jellyfinResult = await authenticateByName(
        { baseUrl: serverUrl, username: input.username, password: input.password, authContext },
        apiFetch,
      );

      // Jellyseerr login is optional — a failure here leaves the
      // Jellyfin half intact and the user still lands on `(app)`.
      // The cookie is **per-user** and travels on the
      // `AuthenticatedUser` record (see memory:
      // project_jellyfuse_auth_architecture).
      let jellyseerrCookie: string | undefined;
      if (jellyseerrUrl) {
        try {
          const session = await jellyseerrLogin(
            { baseUrl: jellyseerrUrl, username: input.username, password: input.password },
            apiFetch,
          );
          jellyseerrCookie = session.cookie;
        } catch (err: unknown) {
          console.warn("jellyseerr login failed — continuing without it", err);
          jellyseerrCookie = undefined;
        }
      }

      const user: AuthenticatedUser = {
        userId: jellyfinResult.userId,
        displayName: jellyfinResult.displayName,
        token: jellyfinResult.token,
        ...(jellyseerrCookie !== undefined ? { jellyseerrCookie } : {}),
      };
      const users = await upsertUser(secureUserStorage, user);
      await secureUserStorage.saveActiveUserId(user.userId);

      return {
        ...current,
        users,
        activeUserId: user.userId,
      };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PERSISTED_AUTH_KEY, data);
    },
  });

  const switchUserMutation = useMutation({
    mutationFn: async (userId: string): Promise<PersistedAuth> => {
      const current =
        queryClient.getQueryData<PersistedAuth>(PERSISTED_AUTH_KEY) ?? EMPTY_PERSISTED_AUTH;
      if (!current.users.some((u) => u.userId === userId)) {
        return current;
      }
      await secureUserStorage.saveActiveUserId(userId);
      return { ...current, activeUserId: userId };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PERSISTED_AUTH_KEY, data);
    },
  });

  const removeUserMutation = useMutation({
    mutationFn: async (userId: string): Promise<PersistedAuth> => {
      const current =
        queryClient.getQueryData<PersistedAuth>(PERSISTED_AUTH_KEY) ?? EMPTY_PERSISTED_AUTH;
      const { users, nextActiveUserId } = await removeUserById(secureUserStorage, userId);
      return {
        ...current,
        users,
        activeUserId: nextActiveUserId,
      };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PERSISTED_AUTH_KEY, data);
    },
  });

  const signOutAllMutation = useMutation({
    mutationFn: async (): Promise<PersistedAuth> => {
      await clearSecureStorage();
      return EMPTY_PERSISTED_AUTH;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PERSISTED_AUTH_KEY, data);
    },
  });

  return useMemo<AuthState>(() => {
    const status: AuthStatus = persistedQuery.isPending
      ? "loading"
      : activeUser
        ? "authenticated"
        : "unauthenticated";
    const jellyseerrStatus: JellyseerrStatus = !persisted.jellyseerrUrl
      ? "not-configured"
      : activeUser?.jellyseerrCookie
        ? "connected"
        : "disconnected";
    return {
      status,
      serverUrl: persisted.serverUrl,
      serverVersion: persisted.serverVersion,
      users: persisted.users,
      activeUser,
      jellyseerrUrl: persisted.jellyseerrUrl,
      jellyseerrStatus,
      setServer: (args) => setServerMutation.mutateAsync(args).then(() => undefined),
      signInWithCredentials: (args) => signInMutation.mutateAsync(args).then(() => undefined),
      switchUser: (userId) => switchUserMutation.mutateAsync(userId).then(() => undefined),
      removeUser: (userId) => removeUserMutation.mutateAsync(userId).then(() => undefined),
      signOutAll: () => signOutAllMutation.mutateAsync().then(() => undefined),
    };
  }, [
    persistedQuery.isPending,
    persisted,
    activeUser,
    setServerMutation,
    signInMutation,
    switchUserMutation,
    removeUserMutation,
    signOutAllMutation,
  ]);
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
