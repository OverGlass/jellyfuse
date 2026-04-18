import { authenticateByName, jellyseerrLogin, type AuthenticatedUser } from "@jellyfuse/api";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import NitroCookies from "react-native-nitro-cookies";
import { apiFetch } from "@/services/api/client";
import {
  getSecureItem,
  removeSecureItem,
  SecureStorageKey,
  setSecureItem,
} from "@/services/secure-storage";
import { clearAllScrollStates } from "@/services/nav-state/store";
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
  /**
   * Re-authenticate the active user against Jellyseerr. Used by the
   * Settings "Reconnect" action when a stored cookie has expired —
   * we still have the Jellyfin token but the cookie jar's connect.sid
   * is gone or rejected. Throws if Jellyseerr returns a non-2xx; the
   * caller should surface the error inline. Updates the active user
   * record's `jellyseerrCookie` on success.
   */
  reconnectJellyseerr: (input: { password: string }) => Promise<void>;
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

/**
 * Drop every cached query except the `auth` namespace. Used on user
 * switch / remove / sign-out so per-user data (shelves, detail,
 * downloads progress) doesn't leak across profiles. `queryClient.clear()`
 * would also evict PERSISTED_AUTH_KEY and trigger an immediate
 * loadPersistedAuth re-fetch before setQueryData could seed the new
 * shape — using a predicate keeps auth intact and avoids the race.
 */
function clearQueryCacheExceptAuth(queryClient: QueryClient): void {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== "auth",
  });
}

/**
 * Actions only — the slice of `AuthState` whose references are stable
 * enough to live behind `AuthContext`. State fields (status, users,
 * activeUser, …) deliberately do **not** go through context: consumers
 * subscribe to the query cache directly via `useAuth()` so they read
 * the latest snapshot on mount, without waiting for `AuthProvider` to
 * re-render and commit a new context value (see bug #85).
 */
type AuthActions = Pick<
  AuthState,
  | "setServer"
  | "signInWithCredentials"
  | "switchUser"
  | "removeUser"
  | "signOutAll"
  | "reconnectJellyseerr"
>;

const AuthActionsContext = createContext<AuthActions | null>(null);

interface Props {
  children: ReactNode;
}

/**
 * Provides the auth action callbacks. State is **not** provided here —
 * consumers pull state straight from the TanStack Query cache via
 * `useAuth()`, which subscribes an observer per call site. This removes
 * the render-order race that a state-in-context setup has: after a
 * mutation writes the cache, every active `useQuery` observer rereads
 * synchronously on its next render, so a freshly-mounted `IndexRoute`
 * sees authenticated state immediately instead of whatever the last
 * `AuthProvider` commit published.
 */
export function AuthProvider({ children }: Props) {
  const actions = useAuthActionsInternal();
  return <AuthActionsContext.Provider value={actions}>{children}</AuthActionsContext.Provider>;
}

/**
 * Mounts every auth mutation once per `AuthProvider` and returns the
 * stable action surface. Kept separate from the provider so
 * `AuthProvider` stays a trivial wrapper.
 */
function useAuthActionsInternal(): AuthActions {
  const queryClient = useQueryClient();

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
        ...(jellyfinResult.avatarUrl !== undefined ? { avatarUrl: jellyfinResult.avatarUrl } : {}),
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
      // Drop every saved scroll offset — the previous user's nav
      // positions are meaningless against the new user's library.
      clearAllScrollStates();
      return { ...current, activeUserId: userId };
    },
    onSuccess: (data) => {
      // Flip auth state **first** so every useAuth observer re-renders
      // against the new user before we tear down the old user's cached
      // queries. The reverse order races: observers keyed by the old
      // userId momentarily see missing cache entries and re-fetch with
      // credentials that are about to be invalidated.
      queryClient.setQueryData(PERSISTED_AUTH_KEY, data);
      // Drop the previous user's auth-context entry explicitly — the
      // predicate below keeps `['auth', ...]`, which includes context
      // keys, so we evict it by queryKey directly.
      queryClient.removeQueries({ queryKey: ["auth", "context"] });
      // Every cached query key is scoped by userId, but shelves,
      // detail data, downloads progress etc. were fetched as the
      // previous user. Purge everything except the auth namespace so
      // the router stays authenticated through the switch — using a
      // predicate rather than `clear()` avoids re-triggering the
      // PERSISTED_AUTH_KEY queryFn between removal and reseeding.
      clearQueryCacheExceptAuth(queryClient);
    },
  });

  const removeUserMutation = useMutation({
    mutationFn: async (
      userId: string,
    ): Promise<{ persisted: PersistedAuth; activeChanged: boolean }> => {
      const current =
        queryClient.getQueryData<PersistedAuth>(PERSISTED_AUTH_KEY) ?? EMPTY_PERSISTED_AUTH;
      const previousActiveId = current.activeUserId;
      const { users, nextActiveUserId } = await removeUserById(secureUserStorage, userId);
      const activeChanged = nextActiveUserId !== previousActiveId;
      if (activeChanged) {
        clearAllScrollStates();
      }
      return {
        persisted: { ...current, users, activeUserId: nextActiveUserId },
        activeChanged,
      };
    },
    onSuccess: ({ persisted, activeChanged }) => {
      // Flip auth state first so consumers see the new user list
      // immediately, then purge old per-user data.
      queryClient.setQueryData(PERSISTED_AUTH_KEY, persisted);
      if (activeChanged) {
        queryClient.removeQueries({ queryKey: ["auth", "context"] });
        clearQueryCacheExceptAuth(queryClient);
      }
    },
  });

  const reconnectJellyseerrMutation = useMutation({
    mutationFn: async ({ password }: { password: string }): Promise<PersistedAuth> => {
      const current =
        queryClient.getQueryData<PersistedAuth>(PERSISTED_AUTH_KEY) ?? EMPTY_PERSISTED_AUTH;
      const { jellyseerrUrl, activeUserId, users } = current;
      if (!jellyseerrUrl) {
        throw new Error("Jellyseerr URL is not configured");
      }
      const activeUser = users.find((u) => u.userId === activeUserId);
      if (!activeUser) {
        throw new Error("No active user — sign in to Jellyfin first");
      }

      // Drop the stale cookie before logging in so the native jar
      // doesn't replay the rejected connect.sid on the auth POST.
      try {
        await NitroCookies.clearByName(jellyseerrUrl, "connect.sid");
      } catch (err: unknown) {
        console.warn("failed to clear stale jellyseerr cookie before reconnect", err);
      }

      const session = await jellyseerrLogin(
        { baseUrl: jellyseerrUrl, username: activeUser.displayName, password },
        apiFetch,
      );
      let cookie = session.cookie ?? undefined;
      if (!cookie) {
        // Same Set-Cookie-hidden fallback as signInMutation — read the
        // freshly-minted connect.sid out of the native jar populated by
        // Nitro Fetch's URLSession.
        const jar = NitroCookies.getSync(jellyseerrUrl);
        cookie = jar["connect.sid"]?.value;
      }
      if (!cookie) {
        throw new Error("connect.sid cookie not found after Jellyseerr login");
      }

      const updatedUser: AuthenticatedUser = { ...activeUser, jellyseerrCookie: cookie };
      const nextUsers = users.map((u) => (u.userId === updatedUser.userId ? updatedUser : u));
      await secureUserStorage.saveUsers(nextUsers);

      return { ...current, users: nextUsers };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PERSISTED_AUTH_KEY, data);
      queryClient.setQueryData(JELLYSEERR_LAST_ERROR_KEY, null);
      // Retry every query currently in error — Jellyseerr-backed reads
      // (requests list, download progress, blended search) likely failed
      // with the rejected cookie. Predicate-invalidation keeps the
      // refetch surgical: untouched success-state queries don't churn.
      queryClient.invalidateQueries({
        predicate: (q) => q.state.status === "error",
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      queryClient.setQueryData(JELLYSEERR_LAST_ERROR_KEY, message);
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

      // Drop every saved scroll offset so a fresh sign-in doesn't
      // inherit the previous account's nav positions.
      clearAllScrollStates();

      return {
        ...current,
        users: [],
        activeUserId: undefined,
      };
    },
    onSuccess: (data) => {
      // Flip auth state first — every useAuth observer re-renders
      // against the signed-out shape, routing bounces to the auth
      // group, THEN we clear the now-unmounted per-user queries.
      queryClient.setQueryData(PERSISTED_AUTH_KEY, data);
      queryClient.setQueryData(JELLYSEERR_LAST_ERROR_KEY, null);
      queryClient.removeQueries({ queryKey: ["auth", "context"] });
      clearQueryCacheExceptAuth(queryClient);
    },
  });

  // React Compiler handles memoisation — no manual useMemo per
  // CLAUDE.md.
  return {
    setServer: (args) => setServerMutation.mutateAsync(args).then(() => undefined),
    signInWithCredentials: (args) => signInMutation.mutateAsync(args).then(() => undefined),
    switchUser: (userId) => switchUserMutation.mutateAsync(userId).then(() => undefined),
    removeUser: (userId) => removeUserMutation.mutateAsync(userId).then(() => undefined),
    signOutAll: () => signOutAllMutation.mutateAsync().then(() => undefined),
    reconnectJellyseerr: (args) =>
      reconnectJellyseerrMutation.mutateAsync(args).then(() => undefined),
  };
}

/**
 * Reads the current auth snapshot and returns the full `AuthState`
 * (state + action callbacks).
 *
 * State comes from subscribing directly to the TanStack Query cache —
 * `useQuery(PERSISTED_AUTH_KEY)` here, in every call site. Each mount
 * reads the cache snapshot synchronously, so a component that mounts
 * right after `setQueryData` (e.g. `IndexRoute` after `router.replace`
 * in the sign-in flow) sees the fresh state without waiting for
 * `AuthProvider` to re-render and commit a new context value. The
 * action callbacks — stable references — come through
 * `AuthActionsContext`.
 *
 * This split is what fixes bug #85 (double sign-in): a state-in-context
 * design raced `AuthProvider`'s commit against the navigator's mount.
 */
export function useAuth(): AuthState {
  const actions = useContext(AuthActionsContext);
  if (!actions) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }

  const persistedQuery = useQuery({
    queryKey: PERSISTED_AUTH_KEY,
    queryFn: loadPersistedAuth,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });
  const jellyseerrLastErrorQuery = useQuery({
    queryKey: JELLYSEERR_LAST_ERROR_KEY,
    queryFn: () => null as string | null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });

  const persisted = persistedQuery.data ?? EMPTY_PERSISTED_AUTH;
  const activeUser = findActiveUser(persisted);
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
    jellyseerrLastError: jellyseerrLastErrorQuery.data ?? undefined,
    ...actions,
  };
}
