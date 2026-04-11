import { colors } from "@jellyfuse/theme";
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/services/auth/state";

/**
 * Root route. Three-way switch on `AuthProvider` status, with a splash
 * placeholder for the hydration window so the app doesn't bounce into
 * sign-in for a frame before landing on the right destination:
 *
 * - `loading` → splash (secure-storage read in flight)
 * - `authenticated` → `(app)` home
 * - `unauthenticated` with no server URL → `(auth)/server`
 * - `unauthenticated` with a server URL → `(auth)/sign-in`
 *
 * Phase 1b.4 will add profile-picker routing for the "multi-user, at
 * least one signed in" case.
 */
export default function IndexRoute() {
  const { status, serverUrl } = useAuth();
  if (status === "loading") {
    return <SplashPlaceholder />;
  }
  if (status === "authenticated") {
    return <Redirect href="/(app)" />;
  }
  if (!serverUrl) {
    return <Redirect href="/(auth)/server" />;
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
