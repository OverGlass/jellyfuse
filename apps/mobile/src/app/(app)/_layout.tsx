import { colors } from "@jellyfuse/theme";
import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/services/auth/state";

/**
 * `(app)` route group — the protected area. Home, detail, player, search,
 * downloads, settings, requests. Unauthenticated users get kicked back to
 * the auth group; the `loading` state renders a splash placeholder so we
 * don't bounce into sign-in during the half-second hydration window.
 */
export default function AppLayout() {
  const { status } = useAuth();
  if (status === "loading") {
    return <SplashPlaceholder />;
  }
  // Bounce back to the root router — it's the single source of
  // routing truth (server configured? user signed in? Jellyseerr
  // URL set? → one decision tree in app/index.tsx).
  if (status !== "authenticated") {
    return <Redirect href="/" />;
  }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name="player/[jellyfinId]"
        options={{ presentation: "fullScreenModal", animation: "fade" }}
      />
      <Stack.Screen
        name="download-quality/[itemId]"
        options={{
          // Native sheet with a single compact detent — the quality
          // list is four rows, so we size to content instead of the
          // 50%/95% detents used by the richer request flow.
          presentation: "formSheet",
          sheetGrabberVisible: true,
          sheetAllowedDetents: "fitToContents",
          sheetCornerRadius: 24,
        }}
      />
      <Stack.Screen
        name="request/[tmdbId]"
        options={{
          // `formSheet` resolves natively per platform: bottom sheet
          // on iPhone, centered floating card on iPad, modal window
          // on Mac Catalyst, standard modal on Android. No platform
          // branches needed in the screen itself.
          //
          // Two detents (medium 50% → large 95%) so the sheet has a
          // predictable bounded height. The step content's ScrollView
          // can then claim `flex: 1` and the footer CTAs stay
          // visible at any detent regardless of how many seasons or
          // profiles the list contains. `fitToContents` would grow
          // and shrink the sheet around the content height but loses
          // the pinned-footer invariant once the content gets tall
          // enough to exceed the system cap.
          presentation: "formSheet",
          sheetGrabberVisible: true,
          sheetAllowedDetents: [0.5, 0.95],
          sheetInitialDetentIndex: 1,
          sheetCornerRadius: 24,
        }}
      />
    </Stack>
  );
}

function SplashPlaceholder() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator color={colors.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
  },
});
