import { authenticateByName, jellyseerrLogin, type AuthenticatedUser } from "@jellyfuse/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import NitroCookies from "react-native-nitro-cookies";
import { apiFetch } from "@/services/api/client";
import {
  getSecureItem,
  removeSecureItem,
  SecureStorageKey,
  setSecureItem,
} from "@/services/secure-storage";
import { buildPreAuthContext } from "./auth-context-builder";
import {
  EMPTY_PERSISTED_AUTH,
  findActiveUser,
  PERSISTED_AUTH_KEY,
  type PersistedAuth,
} from "./persisted-auth";
import { removeUserById, secureUserStorage, upsertUser } from "./users";

/**
 * Multi-user auth state for Jellyfuse. Ports the Rust model from
 * `crates/jf-core/src/state.rs` + `crates/jf-core/src/models.rs`
 * (Settings + authenticated_users sled tree) into a React Query cache.
 *
 * **No useEffects at all** per the project rule (see memory:
 * `feedback_no_async_useeffect` and the React docs page
 * https://react.dev/learn/you-might-not-need-an-effect). Every bit of
 * async work — hydrating from secure-storage, building the auth
 * context, calling `authenticateByName` / `jellyseerrLogin`,
 * persisting users — runs through React Query. The cache at
 * `['auth', 'persisted']` is the single source of truth; mutations
 * write to secure-storage and then `setQueryData` the new shape back.
 *
 * Out-of-React fetchers (`apiFetchAuthenticated`, `jellyseerrFetch`)
 * read the cache via `queryClient.getQueryData` + `fetchQuery` —
 * no module-level refs, no synchronous ref-push side effects.
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
  /** Debug: last Jellyseerr sign-in error, if any. Cleared on next attempt. */
  jellyseerrLastError: string | undefined;

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

const JELLYSEERR_LAST_ERROR_KEY = ["auth", "jellyseerrLastError"] as const;

const AuthContext = createContext<AuthState | null>(null);

interface Props {
  children: ReactNode;
}

/**
 * Wraps the app in the AuthContext. Does no async work itself — the
 * queries + mutations live in `useAuthInternal` which is evaluated
 * inside this component and forwarded through the context.
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
  const activeUser = findActiveUser(persisted);

  const jellyseerrLastErrorQuery = useQuery({
    queryKey: JELLYSEERR_LAST_ERROR_KEY,
    queryFn: () => null as string | null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
    enabled: false,
    initialData: null,
  });

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
      // `AuthenticatedUser` record.
      //
      // React Native's Fetch API (including Nitro Fetch) hides the
      // Set-Cookie response header from JavaScript per the browser
      // "forbidden response header" rule, so `session.cookie` is
      // always null in the app. We fall back to reading it out of
      // the native cookie jar via `react-native-nitro-cookies`, which
      // Nitro Fetch's URLSession has already populated automatically.
      let jellyseerrCookie: string | undefined;
      if (jellyseerrUrl) {
        try {
          const session = await jellyseerrLogin(
            { baseUrl: jellyseerrUrl, username: input.username, password: input.password },
            apiFetch,
          );
          jellyseerrCookie = session.cookie ?? undefined;
          if (!jellyseerrCookie) {
            const jar = NitroCookies.getSync(jellyseerrUrl);
            jellyseerrCookie = jar["connect.sid"]?.value;
            if (!jellyseerrCookie) {
              throw new Error("connect.sid cookie not found in native jar after Jellyseerr login");
            }
          }
          queryClient.setQueryData(JELLYSEERR_LAST_ERROR_KEY, null);
        } catch (err: unknown) {
          const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          console.warn("jellyseerr login failed — continuing without it", err);
          queryClient.setQueryData(JELLYSEERR_LAST_ERROR_KEY, message);
          jellyseerrCookie = undefined;
        }
      } else {
        queryClient.setQueryData(JELLYSEERR_LAST_ERROR_KEY, null);
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
      const current =
        queryClient.getQueryData<PersistedAuth>(PERSISTED_AUTH_KEY) ?? EMPTY_PERSISTED_AUTH;

      // Clear the native Jellyseerr session cookie so the next
      // user gets a fresh session rather than inheriting the
      // previous user's connect.sid from the native jar.
      if (current.jellyseerrUrl) {
        try {
          await NitroCookies.clearByName(current.jellyseerrUrl, "connect.sid");
        } catch (err: unknown) {
          console.warn("failed to clear native jellyseerr cookie on sign-out", err);
        }
      }

      // "Sign out" keeps the server configuration — the user stays
      // connected to this Jellyfin+Jellyseerr pair, they just log out
      // of their account. Next screen is /(auth)/sign-in, not
      // /(auth)/server. A separate "Forget server" action (Phase 6
      // settings) will wipe the server URLs if the user wants to
      // switch instances.
      await secureUserStorage.saveUsers([]);
      await secureUserStorage.saveActiveUserId(undefined);

      // Evict every auth-context entry so the next signed-in user
      // gets a fresh fetchQuery build rather than a stale cached one.
      queryClient.removeQueries({ queryKey: ["auth", "context"] });
      queryClient.setQueryData(JELLYSEERR_LAST_ERROR_KEY, null);

      return {
        ...current,
        users: [],
        activeUserId: undefined,
      };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PERSISTED_AUTH_KEY, data);
    },
  });

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

  // React Compiler handles memoisation — no manual useMemo per
  // CLAUDE.md. The returned shape is stable because its inputs
  // (persisted, activeUser, mutation refs) are themselves stable
  // across renders when nothing has changed.
  return {
    status,
    serverUrl: persisted.serverUrl,
    serverVersion: persisted.serverVersion,
    users: persisted.users,
    activeUser,
    jellyseerrUrl: persisted.jellyseerrUrl,
    jellyseerrStatus,
    jellyseerrLastError: jellyseerrLastErrorQuery.data ?? undefined,
    setServer: (args) => setServerMutation.mutateAsync(args).then(() => undefined),
    signInWithCredentials: (args) => signInMutation.mutateAsync(args).then(() => undefined),
    switchUser: (userId) => switchUserMutation.mutateAsync(userId).then(() => undefined),
    removeUser: (userId) => removeUserMutation.mutateAsync(userId).then(() => undefined),
    signOutAll: () => signOutAllMutation.mutateAsync().then(() => undefined),
  };
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
