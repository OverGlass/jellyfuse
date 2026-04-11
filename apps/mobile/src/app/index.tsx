import { colors } from "@jellyfuse/theme";
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/services/auth/state";

/**
 * Root route. Redirects into the correct route group based on auth state.
 * Auth-group vs app-group layouts handle all per-group concerns; this
 * screen is the entry-point switch + the splash placeholder while
 * AuthProvider is hydrating from secure-storage on boot.
 *
 * Phase 1b.2 adds the server-then-credentials split — for now any
 * unauthenticated state lands on the Phase 0b.2 sign-in placeholder,
 * which flips to authenticated via the in-memory `enterDemoMode` action.
 */
export default function IndexRoute() {
  const { status } = useAuth();
  if (status === "loading") {
    return <SplashPlaceholder />;
  }
  if (status === "authenticated") {
    return <Redirect href="/(app)" />;
  }
  return <Redirect href="/(auth)/sign-in" />;
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
