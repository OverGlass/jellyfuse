import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
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
 * The root is a Stack (not a Slot) so cross-group navigations happen
 * inside a single navigator and modal presentation actually works. The
 * profile picker lives at the root level specifically so it can be
 * presented as a modal over `(app)` from the home header — putting it
 * inside `(auth)` would unmount `(app)` on navigation instead of
 * layering over it.
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
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(app)" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="profile-picker" options={{ presentation: "modal" }} />
          </Stack>
        </ThemeProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
