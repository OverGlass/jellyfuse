import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Minimal auth state for Phase 0b.2. Real Jellyfin AuthenticateByName flow
 * + secure-storage persistence lands in Phase 1 — here we just model the
 * shape and expose a context so the route-group redirects have something
 * to read.
 */

export type AuthStatus = "unauthenticated" | "authenticated";

interface AuthState {
  status: AuthStatus;
  /** Temporary dev shortcut used by the sign-in placeholder screen. */
  enterDemoMode: () => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

interface Props {
  children: ReactNode;
}

export function AuthProvider({ children }: Props) {
  const [status, setStatus] = useState<AuthStatus>("unauthenticated");
  const value: AuthState = {
    status,
    enterDemoMode: () => setStatus("authenticated"),
    signOut: () => setStatus("unauthenticated"),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
