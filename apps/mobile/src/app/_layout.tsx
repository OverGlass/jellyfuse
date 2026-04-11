import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/services/auth/state";
import { QueryProvider } from "@/services/query";

/**
 * Root layout. Wires the three providers every screen needs:
 *
 * 1. `QueryProvider` — TanStack Query + MMKV persister (hydrate-as-stale).
 * 2. `AuthProvider` — auth state the route groups read for redirects.
 * 3. `ThemeProvider` — React Navigation theme (dark-first for Phase 0b).
 *
 * Route-group redirects (unauth → `(auth)`, auth → `(app)`) live in each
 * group's `_layout.tsx` so the redirect logic is colocated with the group
 * it protects, per Expo Router conventions.
 */
export default function RootLayout() {
  return (
    <QueryProvider>
      <AuthProvider>
        <ThemeProvider value={DarkTheme}>
          <StatusBar style="light" />
          <Slot />
        </ThemeProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
