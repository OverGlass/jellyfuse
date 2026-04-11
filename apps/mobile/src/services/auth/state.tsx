import type { AuthenticatedUser } from "@jellyfuse/api";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearSecureStorage,
  getSecureItem,
  removeSecureItem,
  SecureStorageKey,
  setSecureItem,
} from "@/services/secure-storage";
import { findUserById, removeUserById, secureUserStorage, upsertUser } from "./users";

/**
 * Multi-user auth state for Jellyfuse. Ports the Rust model from
 * `crates/jf-core/src/state.rs:509-521` + `crates/jf-core/src/models.rs`
 * (Settings + authenticated_users sled tree) into a single React context.
 *
 * Phase 1b.1 (ARK-6) wires the data layer and hydrates from secure-storage
 * on boot. Phases 1b.2–1b.4 fill in the real UI actions; the `addUser` /
 * `switchUser` / `removeUser` / `signOutAll` methods are live here so
 * consuming screens can wire against a stable ABI from the start.
 *
 * `enterDemoMode` is a temporary back-compat action for the 0b.2 sign-in
 * placeholder — synthesises an in-memory fake user without persisting
 * anything. Deleted in Phase 1b.2 when the real sign-in screen lands.
 */

export type AuthStatus = "loading" | "unauthenticated" | "authenticated";

export interface AuthState {
  status: AuthStatus;
  serverUrl: string | undefined;
  serverVersion: string | undefined;
  users: AuthenticatedUser[];
  activeUser: AuthenticatedUser | undefined;
  jellyseerrUrl: string | undefined;
  jellyseerrConfigured: boolean;

  setServer: (url: string, version: string | undefined) => Promise<void>;
  addUser: (user: AuthenticatedUser) => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
  signOutAll: () => Promise<void>;

  /** @deprecated Phase 0b.2 back-compat — deleted in Phase 1b.2. */
  enterDemoMode: () => void;
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

  // Hydrate from secure-storage on mount. Each read hits a different key
  // and has no ordering dependency, so they run in parallel.
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
      // Hydration failures should not wedge the app at the splash — log
      // and fall through to unauthenticated so the sign-in flow can run.
      console.warn("auth hydration failed", err);
      if (!cancelled) {
        setState({ ...LOADING_STATE, status: "unauthenticated" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setServer = useCallback(async (url: string, version: string | undefined) => {
    await setSecureItem(SecureStorageKey.jellyfinServerUrl, url);
    if (version) {
      await setSecureItem(SecureStorageKey.jellyfinServerVersion, version);
    } else {
      await removeSecureItem(SecureStorageKey.jellyfinServerVersion);
    }
    setState((prev) => ({ ...prev, serverUrl: url, serverVersion: version }));
  }, []);

  const addUser = useCallback(async (user: AuthenticatedUser) => {
    const users = await upsertUser(secureUserStorage, user);
    await secureUserStorage.saveActiveUserId(user.userId);
    setState((prev) => ({
      ...prev,
      status: "authenticated",
      users,
      activeUserId: user.userId,
    }));
  }, []);

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

  const enterDemoMode = useCallback(() => {
    // In-memory only — nothing hits secure-storage. Phase 1b.2 deletes
    // this path entirely when the real sign-in screen takes over.
    const demoUser: AuthenticatedUser = {
      userId: "demo-user",
      displayName: "Demo",
      token: "demo-token",
    };
    setState((prev) => ({
      ...prev,
      status: "authenticated",
      users: [demoUser],
      activeUserId: demoUser.userId,
    }));
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
      addUser,
      switchUser,
      removeUser,
      signOutAll,
      enterDemoMode,
    };
  }, [state, setServer, addUser, switchUser, removeUser, signOutAll, enterDemoMode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
