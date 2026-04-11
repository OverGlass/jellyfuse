import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/services/auth/state";

/**
 * Phase 0b.2 sign-in placeholder. Real AuthenticateByName + server-URL flow
 * lands in Phase 1. For now this is the default entry point for a fresh
 * install and has a single "Enter demo mode" button that flips auth state
 * to `authenticated` so we can see the `(app)` group renders.
 */
export default function SignInScreen() {
  const { enterDemoMode } = useAuth();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Welcome to Jellyfuse</Text>
        <Text style={styles.subtitle}>Phase 0b.2 · auth scaffold</Text>
        <Pressable
          accessibilityRole="button"
          onPress={enterDemoMode}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonLabel}>Enter demo mode</Text>
        </Pressable>
        <Text style={styles.hint}>
          Real sign in wires up in Phase 1 (AuthenticateByName + profile picker).
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    textAlign: "center",
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.bodyLarge,
    marginBottom: spacing.xl,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: spacing.sm,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xl,
    textAlign: "center",
  },
});
