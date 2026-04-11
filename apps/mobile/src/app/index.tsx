import { STALE_TIMES } from "@jellyfuse/query-keys"
import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme"
import { StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

/**
 * Phase 0b.1 hello screen. Proves workspace packages are wired in and that
 * the Expo Router + React Compiler + typed routes pipeline is working.
 * Replaced by the real Home screen in Phase 2.
 */
export default function HelloScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Jellyfuse</Text>
        <Text style={styles.subtitle}>Phase 0b.1 scaffold</Text>
        <Text style={styles.meta}>
          home shelf stale time: {STALE_TIMES.homeShelf / 1000}s
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.bodyLarge,
  },
  meta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xl,
  },
})
