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

/**
 * Phase 1b.3 home screen. Adds a JELLYSEERR meta row alongside the
 * USER / SERVER / STATUS / PRODUCT / DEVICE rows so we can see the
 * optional Jellyseerr session's state alongside the Jellyfin one.
 * Shelves stay mocked until Phase 2 ports the real home query keys.
 */
export function HomeScreen() {
  // Placeholder for player / download screens that land in Phase 3/5 —
  // `useKeepAwake` is wired from day 1 so we catch any native breakage.
  useKeepAwake();

  const { serverUrl, activeUser, jellyseerrUrl, jellyseerrStatus, signOutAll } = useAuth();
  const systemInfo = useSystemInfo(serverUrl);
  const deviceId = useDeviceId();

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlashList
        data={mockShelves}
        keyExtractor={(shelf) => shelf.id}
        ListHeaderComponent={
          <Header
            userLabel={activeUser?.displayName ?? "Signed in"}
            serverLabel={serverUrl?.replace(/^https?:\/\//, "") ?? "—"}
            status={statusLabel(systemInfo)}
            product={
              systemInfo.data
                ? `${systemInfo.data.productName} ${systemInfo.data.version}`
                : undefined
            }
            deviceId={deviceId}
            jellyseerrLabel={jellyseerrLabel(jellyseerrStatus, jellyseerrUrl)}
            onSignOut={signOutAll}
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

function jellyseerrLabel(
  status: ReturnType<typeof useAuth>["jellyseerrStatus"],
  url: string | undefined,
): string {
  switch (status) {
    case "not-configured":
      return "not configured";
    case "connected":
      return `connected · ${url?.replace(/^https?:\/\//, "") ?? "—"}`;
    case "disconnected":
      return "disconnected";
  }
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
  userLabel: string;
  serverLabel: string;
  status: string;
  product: string | undefined;
  deviceId: string | undefined;
  jellyseerrLabel: string;
  onSignOut: () => void;
}

function Header({
  userLabel,
  serverLabel,
  status,
  product,
  deviceId,
  jellyseerrLabel,
  onSignOut,
}: HeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Jellyfuse</Text>
      <Text style={styles.subtitle}>Phase 1b.3 · jellyseerr login + connect.sid</Text>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>USER</Text>
        <Text style={styles.metaValue}>{userLabel}</Text>
      </View>
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
        <Text style={styles.metaLabel}>JELLYSEERR</Text>
        <Text style={styles.metaValue} numberOfLines={1}>
          {jellyseerrLabel}
        </Text>
      </View>
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
    width: 88,
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
