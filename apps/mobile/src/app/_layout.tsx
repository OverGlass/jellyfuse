import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/services/auth/state";
import { DownloaderProvider } from "@/services/downloads/context";
import { useLocalDownloadsSync } from "@/services/downloads/use-local-downloads";
import { useReportDrainer } from "@/services/playback/use-report-drainer";
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
/**
 * Inner layout rendered inside all providers — mounts the download
 * sync hook which subscribes to Nitro events and keeps RQ up-to-date.
 */
function AppShell() {
  useLocalDownloadsSync();
  useReportDrainer();
  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="profile-picker" options={{ presentation: "modal" }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryProvider>
          <AuthProvider>
            <DownloaderProvider>
              <AppShell />
            </DownloaderProvider>
          </AuthProvider>
        </QueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
