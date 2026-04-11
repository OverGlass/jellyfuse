import { authenticateByName, jellyseerrLogin, type AuthenticatedUser } from "@jellyfuse/api";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
 * `crates/jf-core/src/state.rs:509-521` + `crates/jf-core/src/models.rs`
 * (Settings + authenticated_users sled tree) into a single React context.
 *
 * Phase 1b.3 (ARK-8) adds the Jellyseerr session layer alongside the
 * Jellyfin auth — `setServer` optionally takes a Jellyseerr URL,
 * `signInWithCredentials` chains `jellyseerrLogin` after the Jellyfin
 * auth completes, and a companion effect keeps the `jellyseerrFetch`
 * ref populated with the persisted `connect.sid` cookie. Jellyseerr
 * failures are non-fatal per the Rust spec — the Jellyfin half
 * succeeds and the user lands on the home screen either way.
 */

export type AuthStatus = "loading" | "unauthenticated" | "authenticated";

/** Whether the Jellyseerr side of the session is usable right now. */
export type JellyseerrStatus =
  | "not-configured" // no URL set
  | "connected" // URL set + cookie present
  | "disconnected"; // URL set but no valid cookie (failed login / expired)

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

const AuthContext = createContext<AuthState | null>(null);

interface Props {
  children: ReactNode;
}

interface InternalState {
  status: AuthStatus;
  serverUrl: string | undefined;
  serverVersion: string | undefined;
  users: AuthenticatedUser[];
  activeUserId: string | undefined;
  jellyseerrUrl: string | undefined;
  jellyseerrCookie: string | undefined;
}

const LOADING_STATE: InternalState = {
  status: "loading",
  serverUrl: undefined,
  serverVersion: undefined,
  users: [],
  activeUserId: undefined,
  jellyseerrUrl: undefined,
  jellyseerrCookie: undefined,
};

export function AuthProvider({ children }: Props) {
  const [state, setState] = useState<InternalState>(LOADING_STATE);
  // Mirror state in a ref so async action callbacks can read the latest
  // values without being re-memoised on every render. Updated via effect
  // below so the ref always trails state by exactly one commit.
  const stateRef = useRef<InternalState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Hydrate from secure-storage on mount. Reads run in parallel because
  // they hit different keys with no ordering dependency.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [serverUrl, serverVersion, activeUserId, jellyseerrUrl, jellyseerrCookie, users] =
        await Promise.all([
          getSecureItem(SecureStorageKey.jellyfinServerUrl),
          getSecureItem(SecureStorageKey.jellyfinServerVersion),
          getSecureItem(SecureStorageKey.jellyfinActiveUserId),
          getSecureItem(SecureStorageKey.jellyseerrUrl),
          getSecureItem(SecureStorageKey.jellyseerrCookie),
          secureUserStorage.loadUsers(),
        ]);
      if (cancelled) return;
      const activeUser = findUserById(users, activeUserId);
      setState({
        status: activeUser ? "authenticated" : "unauthenticated",
        serverUrl,
        serverVersion,
        users,
        activeUserId: activeUser?.userId,
        jellyseerrUrl,
        jellyseerrCookie,
      });
    })().catch((err: unknown) => {
      // Hydration failures should not wedge the app at splash — log and
      // fall through to unauthenticated so the sign-in flow can run.
      console.warn("auth hydration failed", err);
      if (!cancelled) {
        setState({ ...LOADING_STATE, status: "unauthenticated" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the module-level auth-context ref (used by
  // `apiFetchAuthenticated`) in sync with the active user. This runs
  // asynchronously because `buildAuthContextForUser` reads the device id
  // via expo-application — the brief window before the ref is set is
  // harmless because no authenticated calls fire until the user is in
  // the (app) group.
  useEffect(() => {
    const activeUser = findUserById(state.users, state.activeUserId);
    if (!activeUser) {
      setCurrentAuthContext(undefined);
      return;
    }
    let cancelled = false;
    buildAuthContextForUser(activeUser)
      .then((ctx) => {
        if (!cancelled) setCurrentAuthContext(ctx);
      })
      .catch((err: unknown) => {
        console.warn("auth context build failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [state.users, state.activeUserId]);

  // Keep the Jellyseerr cookie ref (used by `jellyseerrFetch`) in sync
  // with the persisted cookie. Runs synchronously because the cookie is
  // already in state — no network calls.
  useEffect(() => {
    setCurrentJellyseerrCookie(state.jellyseerrCookie);
  }, [state.jellyseerrCookie]);

  const setServer = useCallback(
    async ({
      url,
      version,
      jellyseerrUrl,
    }: {
      url: string;
      version: string | undefined;
      jellyseerrUrl: string | undefined;
    }) => {
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
        // Clear any stale cookie so the old session doesn't leak after a
        // Jellyseerr URL change.
        await removeSecureItem(SecureStorageKey.jellyseerrCookie);
      }
      setState((prev) => ({
        ...prev,
        serverUrl: url,
        serverVersion: version,
        jellyseerrUrl,
        jellyseerrCookie: jellyseerrUrl ? prev.jellyseerrCookie : undefined,
      }));
    },
    [],
  );

  const signInWithCredentials = useCallback(
    async ({ username, password }: { username: string; password: string }) => {
      const serverUrl = stateRef.current.serverUrl;
      const jellyseerrUrl = stateRef.current.jellyseerrUrl;
      if (!serverUrl) {
        throw new AuthServerNotConfiguredError();
      }
      const authContext = await buildPreAuthContext();
      const result = await authenticateByName(
        { baseUrl: serverUrl, username, password, authContext },
        apiFetch,
      );
      const user: AuthenticatedUser = {
        userId: result.userId,
        displayName: result.displayName,
        token: result.token,
      };
      const users = await upsertUser(secureUserStorage, user);
      await secureUserStorage.saveActiveUserId(user.userId);

      // Jellyseerr login is optional — a failure here leaves the
      // Jellyfin half intact and the user still lands on `(app)`. The
      // cookie is cleared out so the header row shows "disconnected".
      let jellyseerrCookie: string | undefined;
      if (jellyseerrUrl) {
        try {
          const session = await jellyseerrLogin(
            { baseUrl: jellyseerrUrl, username, password },
            apiFetch,
          );
          await setSecureItem(SecureStorageKey.jellyseerrCookie, session.cookie);
          jellyseerrCookie = session.cookie;
        } catch (err: unknown) {
          console.warn("jellyseerr login failed — continuing without it", err);
          await removeSecureItem(SecureStorageKey.jellyseerrCookie);
          jellyseerrCookie = undefined;
        }
      }

      setState((prev) => ({
        ...prev,
        status: "authenticated",
        users,
        activeUserId: user.userId,
        jellyseerrCookie,
      }));
    },
    [],
  );

  const switchUser = useCallback(async (userId: string) => {
    await secureUserStorage.saveActiveUserId(userId);
    setState((prev) => {
      if (!prev.users.some((u) => u.userId === userId)) return prev;
      return { ...prev, status: "authenticated", activeUserId: userId };
    });
  }, []);

  const removeUser = useCallback(async (userId: string) => {
    const { users, nextActiveUserId } = await removeUserById(secureUserStorage, userId);
    setState((prev) => ({
      ...prev,
      status: nextActiveUserId ? "authenticated" : "unauthenticated",
      users,
      activeUserId: nextActiveUserId,
    }));
  }, []);

  const signOutAll = useCallback(async () => {
    await clearSecureStorage();
    setState({
      status: "unauthenticated",
      serverUrl: undefined,
      serverVersion: undefined,
      users: [],
      activeUserId: undefined,
      jellyseerrUrl: undefined,
      jellyseerrCookie: undefined,
    });
  }, []);

  const value = useMemo<AuthState>(() => {
    const activeUser = findUserById(state.users, state.activeUserId);
    const jellyseerrStatus: JellyseerrStatus = !state.jellyseerrUrl
      ? "not-configured"
      : state.jellyseerrCookie
        ? "connected"
        : "disconnected";
    return {
      status: state.status,
      serverUrl: state.serverUrl,
      serverVersion: state.serverVersion,
      users: state.users,
      activeUser,
      jellyseerrUrl: state.jellyseerrUrl,
      jellyseerrStatus,
      setServer,
      signInWithCredentials,
      switchUser,
      removeUser,
      signOutAll,
    };
  }, [state, setServer, signInWithCredentials, switchUser, removeUser, signOutAll]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
