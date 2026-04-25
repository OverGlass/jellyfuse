import { DarkTheme, ThemeProvider } from "@react-navigation/native";
import { colors } from "@jellyfuse/theme";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/services/auth/state";
import { DownloaderProvider } from "@/services/downloads/context";
import { useLocalDownloadsSync } from "@/services/downloads/use-local-downloads";
import { useReportDrainer } from "@/services/playback/use-report-drainer";
import { QueryProvider } from "@/services/query";

// Keep the native splash up until the first real view has laid out
// AND auth state has resolved — otherwise the user sees an empty
// background flash between the splash dismissing and the destination
// screen painting. `preventAutoHideAsync` runs at module load, before
// any provider mounts. The hide is driven by `onLayoutRootView` below.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden — fine, the user will just see whatever paints
  // first. No way to recover and not worth crashing over.
});

// React Navigation's stock DarkTheme paints `#000` for the navigator
// background + card surfaces, which produces a black flash on cold
// start between the splash screen (matched to `colors.background`)
// hiding and the first screen painting. Override both to the app
// background so the handoff is seamless.
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.background,
  },
};

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
  const { status } = useAuth();

  // Hide the splash only after auth has resolved AND the destination
  // route has had a chance to paint. `useEffect` runs after commit, so
  // the first time it fires with a non-loading status the destination
  // screen's first frame is already on-screen — no empty background
  // flash between splash and content. While `status === "loading"`
  // we no-op and let the splash stay up.
  useEffect(() => {
    if (status === "loading") return;
    SplashScreen.hideAsync().catch(() => {
      // Already hidden — race with auto-hide fallback. Safe to ignore.
    });
  }, [status]);

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Group screens are routing shells, not real navigations — the
            user's destination is one of (app)/(auth) based on auth
            state, decided in app/index.tsx. The Redirect from index
            triggers a Stack push, so without `animation: "none"` the
            user sees a slide-in on cold start when already signed in.
            Inner (app) screens still animate via their own Stack. */}
        <Stack.Screen name="(app)" options={{ animation: "none" }} />
        <Stack.Screen name="(auth)" options={{ animation: "none" }} />
        <Stack.Screen name="profile-picker" options={{ presentation: "modal" }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
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
