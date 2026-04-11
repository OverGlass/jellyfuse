import type { MediaItem } from "@jellyfuse/api";
import { mediaIdJellyfin } from "@jellyfuse/models";
import type { ShelfKey } from "@jellyfuse/query-keys";
import {
  colors,
  duration,
  fontSize,
  fontWeight,
  opacity,
  profileColorFor,
  radius,
  spacing,
} from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConnectionBanner } from "@/features/common/components/connection-banner";
import { MediaShelf, type MediaShelfVariant } from "@/features/home/components/media-shelf";
import { useAuth } from "@/services/auth/state";
import { useConnectionStatus } from "@/services/connection/monitor";
import {
  useContinueWatching,
  useLatestMovies,
  useLatestTv,
  useNextUp,
  useRecentlyAdded,
} from "@/services/query";
import { useScreenGutters } from "@/services/responsive";

/**
 * Phase 2c home screen. Real Jellyfin shelves wired through the
 * `@jellyfuse/api` fetchers + RQ hooks. Responsive from day 1:
 * `useBreakpoint()` drives the screen padding + card sizing so the
 * same layout works on phone / tablet / desktop (Catalyst, iPad,
 * Android TV). Top `ConnectionBanner` covers offline / reconnecting
 * state — when the server is reachable, hooks render cached shelves
 * instantly and revalidate silently (per Phase 2b hydrate-as-stale).
 *
 * Shelf order (from the plan): Continue Watching → Next Up →
 * Recently Added → Latest Movies → Latest TV. Suggestions stays
 * deferred to Phase 4 (Jellyseerr-backed).
 */
export function HomeScreen() {
  useKeepAwake();

  const { activeUser, signOutAll } = useAuth();
  const gutters = useScreenGutters();
  const connectionStatus = useConnectionStatus();

  const continueWatching = useContinueWatching();
  const nextUp = useNextUp();
  const recentlyAdded = useRecentlyAdded();
  const latestMovies = useLatestMovies();
  const latestTv = useLatestTv();

  const shelves: HomeShelf[] = [
    {
      key: "continue-watching",
      title: "Continue Watching",
      variant: "wide",
      query: continueWatching,
    },
    { key: "next-up", title: "Next Up", variant: "poster", query: nextUp },
    { key: "recently-added", title: "Recently Added", variant: "poster", query: recentlyAdded },
    { key: "latest-movies", title: "Latest Movies", variant: "poster", query: latestMovies },
    { key: "latest-tv", title: "Latest TV", variant: "poster", query: latestTv },
  ];

  const visibleShelves = shelves.filter(
    (shelf) => shelf.query.isPending || (shelf.query.data?.length ?? 0) > 0,
  );

  const anyLoading = shelves.some((s) => s.query.isPending);
  const allEmptyOnline =
    !anyLoading &&
    connectionStatus === "online" &&
    shelves.every((s) => (s.query.data?.length ?? 0) === 0);

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <FlashList
        data={visibleShelves}
        keyExtractor={(shelf) => shelf.key}
        ListHeaderComponent={
          <View>
            <HomeHeader
              userLabel={activeUser?.displayName ?? "Signed in"}
              userAvatarUrl={activeUser?.avatarUrl}
              userColorSeed={activeUser?.userId ?? "anonymous"}
              paddingLeft={gutters.left}
              paddingRight={gutters.right}
              onOpenProfiles={handleOpenProfiles}
              onSignOut={signOutAll}
            />
            <ConnectionBanner status={connectionStatus} />
            {anyLoading && visibleShelves.length === 0 ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.textSecondary} />
              </View>
            ) : null}
            {allEmptyOnline ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>No items yet</Text>
                <Text style={styles.emptyBody}>
                  Your library is empty or Jellyfin is still scanning.
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <MediaShelf
            title={item.title}
            items={item.query.data ?? []}
            variant={item.variant}
            onItemPress={handleItemPress}
            onSeeAll={() => handleSeeAll(item.key)}
          />
        )}
        ItemSeparatorComponent={null}
      />
    </SafeAreaView>
  );
}

interface HomeShelf {
  key: ShelfKey;
  title: string;
  variant: MediaShelfVariant;
  query: {
    data: MediaItem[] | undefined;
    isPending: boolean;
  };
}

function handleOpenProfiles() {
  router.push("/profile-picker");
}

function handleSeeAll(shelfKey: ShelfKey) {
  // Phase 2e will route to /shelf/[shelfKey] — warn for now so the
  // chevron is visibly wired but not yet functional.
  console.warn(`see-all tapped: ${shelfKey}`);
}

function handleItemPress(item: MediaItem) {
  const jellyfinId = mediaIdJellyfin(item.id);
  if (!jellyfinId) return;
  // Episodes route to their parent series detail; everything else to
  // the corresponding movie / series page. The TMDB-only detail lands
  // in Phase 4.
  if (item.mediaType === "series") {
    router.push(`/detail/series/${jellyfinId}`);
  } else if (item.mediaType === "episode" && item.seriesId) {
    router.push(`/detail/series/${item.seriesId}`);
  } else {
    router.push(`/detail/movie/${jellyfinId}`);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────────────

interface HeaderProps {
  userLabel: string;
  userAvatarUrl: string | undefined;
  userColorSeed: string;
  paddingLeft: number;
  paddingRight: number;
  onOpenProfiles: () => void;
  onSignOut: () => void;
}

function HomeHeader({
  userLabel,
  userAvatarUrl,
  userColorSeed,
  paddingLeft,
  paddingRight,
  onOpenProfiles,
  onSignOut,
}: HeaderProps) {
  const fallbackColor = profileColorFor(userColorSeed);
  return (
    <View style={[styles.header, { paddingLeft, paddingRight }]}>
      <View style={styles.topRow}>
        <View style={styles.topTitleBlock}>
          <Text style={styles.title}>Jellyfuse</Text>
          <Text style={styles.subtitle}>Signed in as {userLabel}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Switch profile (currently ${userLabel})`}
          onPress={onOpenProfiles}
          style={({ pressed }) => [
            styles.avatarButton,
            !userAvatarUrl && { backgroundColor: fallbackColor },
            pressed && styles.avatarButtonPressed,
          ]}
        >
          {userAvatarUrl ? (
            <Image
              source={userAvatarUrl}
              style={styles.avatarImage}
              contentFit="cover"
              transition={duration.normal}
              recyclingKey={userAvatarUrl}
              cachePolicy="memory-disk"
            />
          ) : (
            <Text style={styles.avatarLetter}>{userLabel.slice(0, 1).toUpperCase()}</Text>
          )}
        </Pressable>
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
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  topRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  topTitleBlock: {
    flex: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  avatarButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    height: 40,
    justifyContent: "center",
    marginLeft: spacing.md,
    marginTop: spacing.xs,
    overflow: "hidden",
    width: 40,
  },
  avatarButtonPressed: {
    opacity: opacity.pressed,
  },
  avatarImage: {
    height: 40,
    width: 40,
  },
  avatarLetter: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.bold,
  },
  signOut: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  signOutPressed: {
    opacity: opacity.pressed,
  },
  signOutLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  centered: {
    alignItems: "center",
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.semibold,
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
  },
});
