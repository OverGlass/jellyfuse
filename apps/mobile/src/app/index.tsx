import { colors } from "@jellyfuse/theme";
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/services/auth/state";

/**
 * Root route. Single source of routing truth:
 *
 * - `loading` → splash (secure-storage hydration in flight)
 * - `authenticated` → `(app)` home
 * - `unauthenticated` + no server URL → `(auth)/server`
 * - `unauthenticated` + server URL + **no saved users** → `(auth)/sign-in`
 * - `unauthenticated` + server URL + **saved users** → `(auth)/profile-picker`
 *
 * The picker case covers sign-out (users list intact, active user
 * cleared) and cold launch when the previously-active user was removed.
 * Both (auth) and (app) sub-layouts bounce to this route on any state
 * mismatch, so routing decisions live in exactly one place.
 */
export default function IndexRoute() {
  const { status, serverUrl, users } = useAuth();
  if (status === "loading") {
    return <SplashPlaceholder />;
  }
  if (status === "authenticated") {
    return <Redirect href="/(app)" />;
  }
  if (!serverUrl) {
    return <Redirect href="/(auth)/server" />;
  }
  if (users.length > 0) {
    return <Redirect href="/profile-picker" />;
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
