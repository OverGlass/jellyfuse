import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { useKeepAwake } from "expo-keep-awake";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MediaShelf } from "@/features/home/components/media-shelf";
import { useDeviceId } from "@/features/home/hooks/use-device-id";
import { mockShelves, type MockMediaItem, type MockShelf } from "@/features/home/mock-shelves";
import { useAuth } from "@/services/auth/state";
import { useSystemInfo } from "@/services/query";

const DEMO_BASE_URL = "https://demo.jellyfin.org/stable";

/**
 * Phase 1a home screen. Adds a live `DEVICE` row showing the id returned
 * from `useDeviceId()` — which goes through
 * `Application.getIosIdForVendorAsync` on iOS and falls back to a
 * secure-storage-persisted UUID — so we can visually confirm the native
 * plumbing on-device. Shelves + system info carry over from 0b.3.
 * Replaced by the real Home feature in Phase 2.
 */
export function HomeScreen() {
  // Placeholder for player / download screens that land in Phase 3/5 —
  // `useKeepAwake` is wired from day 1 so we catch any native breakage.
  useKeepAwake();

  const { signOut } = useAuth();
  const systemInfo = useSystemInfo(DEMO_BASE_URL);
  const deviceId = useDeviceId();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlashList
        data={mockShelves}
        keyExtractor={(shelf) => shelf.id}
        ListHeaderComponent={
          <Header
            serverLabel={DEMO_BASE_URL.replace(/^https?:\/\//, "")}
            status={statusLabel(systemInfo)}
            product={
              systemInfo.data
                ? `${systemInfo.data.productName} ${systemInfo.data.version}`
                : undefined
            }
            deviceId={deviceId}
            onSignOut={signOut}
          />
        }
        renderItem={({ item }: { item: MockShelf }) => (
          <MediaShelf title={item.title} items={item.items} onItemPress={handleItemPress} />
        )}
        ItemSeparatorComponent={null}
      />
    </SafeAreaView>
  );
}

function handleItemPress(item: MockMediaItem) {
  // Placeholder — Phase 2 routes through Expo Router to
  // `/(app)/detail/movie/[jellyfinId]` or `/series/[jellyfinId]`.
  console.warn(`pressed ${item.title} (${item.id})`);
}

function statusLabel(query: ReturnType<typeof useSystemInfo>): string {
  if (query.isLoading) return "loading…";
  if (query.isError) return `error: ${(query.error as Error).message}`;
  if (query.data) return query.isFetching ? "revalidating…" : "ok";
  return "idle";
}

interface HeaderProps {
  serverLabel: string;
  status: string;
  product: string | undefined;
  deviceId: string | undefined;
  onSignOut: () => void;
}

function Header({ serverLabel, status, product, deviceId, onSignOut }: HeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Jellyfuse</Text>
      <Text style={styles.subtitle}>Phase 1a · secure storage + device id + auth api</Text>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>SERVER</Text>
        <Text style={styles.metaValue}>{serverLabel}</Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>STATUS</Text>
        <Text style={styles.metaValue}>{status}</Text>
      </View>
      {product ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>PRODUCT</Text>
          <Text style={styles.metaValue}>{product}</Text>
        </View>
      ) : null}
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>DEVICE</Text>
        <Text style={styles.metaValue} numberOfLines={1}>
          {deviceId ?? "resolving…"}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onSignOut}
        style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
      >
        <Text style={styles.signOutLabel}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    marginBottom: spacing.md,
  },
  metaRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  metaLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    letterSpacing: 1,
    textTransform: "uppercase",
    width: 70,
  },
  metaValue: {
    color: colors.textPrimary,
    fontSize: fontSize.caption,
  },
  signOut: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  signOutPressed: {
    opacity: 0.75,
  },
  signOutLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
});
