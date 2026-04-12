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
