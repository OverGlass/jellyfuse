import { authenticateByName, type AuthenticatedUser } from "@jellyfuse/api";
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
 * Phase 1b.2 (ARK-7) wires the real sign-in flow: `setServer` persists
 * the selected server URL + version, `signInWithCredentials` calls
 * `authenticateByName` via the pre-auth fetcher and upserts the result
 * into the users list. A dedicated effect keeps the module-level auth
 * context ref in `services/api/client.ts` in sync with the active user
 * so `apiFetchAuthenticated` always sees a fresh token.
 */

export type AuthStatus = "loading" | "unauthenticated" | "authenticated";

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
  jellyseerrConfigured: boolean;

  setServer: (url: string, version: string | undefined) => Promise<void>;
  /** Authenticate + upsert + set active user. Throws on auth failure. */
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
}

const LOADING_STATE: InternalState = {
  status: "loading",
  serverUrl: undefined,
  serverVersion: undefined,
  users: [],
  activeUserId: undefined,
  jellyseerrUrl: undefined,
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
      const [serverUrl, serverVersion, activeUserId, jellyseerrUrl, users] = await Promise.all([
        getSecureItem(SecureStorageKey.jellyfinServerUrl),
        getSecureItem(SecureStorageKey.jellyfinServerVersion),
        getSecureItem(SecureStorageKey.jellyfinActiveUserId),
        getSecureItem(SecureStorageKey.jellyseerrUrl),
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

  const setServer = useCallback(async (url: string, version: string | undefined) => {
    await setSecureItem(SecureStorageKey.jellyfinServerUrl, url);
    if (version) {
      await setSecureItem(SecureStorageKey.jellyfinServerVersion, version);
    } else {
      await removeSecureItem(SecureStorageKey.jellyfinServerVersion);
    }
    setState((prev) => ({ ...prev, serverUrl: url, serverVersion: version }));
  }, []);

  const signInWithCredentials = useCallback(
    async ({ username, password }: { username: string; password: string }) => {
      const serverUrl = stateRef.current.serverUrl;
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
      setState((prev) => ({
        ...prev,
        status: "authenticated",
        users,
        activeUserId: user.userId,
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
    });
  }, []);

  const value = useMemo<AuthState>(() => {
    const activeUser = findUserById(state.users, state.activeUserId);
    return {
      status: state.status,
      serverUrl: state.serverUrl,
      serverVersion: state.serverVersion,
      users: state.users,
      activeUser,
      jellyseerrUrl: state.jellyseerrUrl,
      jellyseerrConfigured: Boolean(state.jellyseerrUrl),
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
