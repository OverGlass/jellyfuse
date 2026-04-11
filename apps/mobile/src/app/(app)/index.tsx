import { STALE_TIMES } from "@jellyfuse/query-keys";
import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/services/auth/state";
import { useSystemInfo } from "@/services/query";

/**
 * Phase 0b.2 home placeholder. Replaces the 0b.1 hello screen with a real
 * TanStack Query consumer (`useSystemInfo`) so we can see the RQ + MMKV
 * persister pipeline all the way from the hook to the render.
 *
 * The public Jellyfin demo server exposes `/System/Info/Public`, so we
 * point at it to get a real round-trip without any auth setup. Phase 1
 * replaces the hard-coded URL with the user-entered server URL from the
 * auth flow.
 */
const DEMO_BASE_URL = "https://demo.jellyfin.org/stable";

export default function HomeScreen() {
  const { signOut } = useAuth();
  const systemInfo = useSystemInfo(DEMO_BASE_URL);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Jellyfuse</Text>
        <Text style={styles.subtitle}>Phase 0b.2 · query + persister</Text>

        <View style={styles.statusBlock}>
          <Text style={styles.label}>Server</Text>
          <Text style={styles.value}>{DEMO_BASE_URL.replace(/^https?:\/\//, "")}</Text>
        </View>

        <View style={styles.statusBlock}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{statusLabel(systemInfo)}</Text>
        </View>

        {systemInfo.data ? (
          <View style={styles.statusBlock}>
            <Text style={styles.label}>Product</Text>
            <Text style={styles.value}>
              {systemInfo.data.productName} {systemInfo.data.version}
            </Text>
          </View>
        ) : null}

        <Text style={styles.meta}>
          system info stale time: {STALE_TIMES.systemInfo / 60_000}min · home shelf:{" "}
          {STALE_TIMES.homeShelf / 1000}s
        </Text>

        <Pressable
          accessibilityRole="button"
          onPress={signOut}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonLabel}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function statusLabel(query: ReturnType<typeof useSystemInfo>): string {
  if (query.isLoading) return "loading…";
  if (query.isError) return `error: ${(query.error as Error).message}`;
  if (query.data) return query.isFetching ? "revalidating…" : "ok";
  return "idle";
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
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.bodyLarge,
    marginBottom: spacing.lg,
  },
  statusBlock: {
    alignItems: "center",
    gap: spacing.xs,
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  value: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.medium,
  },
  meta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.md,
    textAlign: "center",
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  buttonLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
});
