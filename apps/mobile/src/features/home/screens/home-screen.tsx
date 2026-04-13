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
import { useDeferredValue, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { ConnectionBanner } from "@/features/common/components/connection-banner";
import { FloatingBlurHeader } from "@/features/common/components/floating-blur-header";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { MediaCard } from "@/features/home/components/media-card";
import { MediaShelf, type MediaShelfVariant } from "@/features/home/components/media-shelf";
import { SearchInput } from "@/features/search/components/search-input";
import { useAuth } from "@/services/auth/state";
import { useConnectionStatus } from "@/services/connection/monitor";
import {
  useContinueWatching,
  useLatestMovies,
  useLatestTv,
  useNextUp,
  useRecentlyAdded,
} from "@/services/query";
import { useSearchBlended } from "@/services/query/hooks/use-search-blended";
import { useBreakpoint, useScreenGutters } from "@/services/responsive";

/**
 * Home screen. Real Jellyfin shelves wired through the
 * `@jellyfuse/api` fetchers + RQ hooks. Responsive from day 1:
 * `useBreakpoint()` drives the screen padding, card sizing, and
 * search-results column count, so the same layout works on phone /
 * iPad / Mac Catalyst / Android TV without per-platform branches.
 *
 * **Search lives here**, not on a separate route. A pinned search
 * bar in the floating blur header drives `useSearchBlended`. Once
 * the user types two or more characters, the shelves are replaced
 * inline with a responsive grid of blended Jellyfin + Jellyseerr
 * results; clearing the input restores the shelves. Mirrors the
 * Rust `HomeView` in `crates/jf-ui-kit/src/views/home.rs` which
 * uses the same in-place swap and a flex-wrap grid of cards.
 *
 * Shelf order (from the plan): Continue Watching → Next Up →
 * Recently Added → Latest Movies → Latest TV. Suggestions stays
 * deferred to a later phase (Jellyseerr-backed).
 */
const MIN_SEARCH_LENGTH = 2;

export function HomeScreen() {
  useKeepAwake();

  const { activeUser, signOutAll } = useAuth();
  const { values } = useBreakpoint();
  const gutters = useScreenGutters();
  const connectionStatus = useConnectionStatus();
  const scrollRestore = useRestoredScroll("/home");

  const [query, setQuery] = useState("");
  const [headerHeight, setHeaderHeight] = useState(0);
  function handleHeaderHeightChange(next: number) {
    if (Math.abs(next - headerHeight) > 0.5) {
      setHeaderHeight(next);
    }
  }
  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.trim();
  const isSearching = trimmedQuery.length >= MIN_SEARCH_LENGTH;
  const search = useSearchBlended(deferredQuery);

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

  const anyShelfLoading = shelves.some((s) => s.query.isPending);
  const allShelvesEmptyOnline =
    !anyShelfLoading &&
    connectionStatus === "online" &&
    shelves.every((s) => (s.query.data?.length ?? 0) === 0);

  // Combine library + requestable into one flat grid (matches Rust
  // `home.rs:307-329` which renders search results as a flex-wrap
  // grid of `render_card_sized` calls — no library/request section
  // headers, just one combined list ordered library-first).
  const searchItems: MediaItem[] =
    isSearching && search.data
      ? [...search.data.libraryItems, ...search.data.requestableItems]
      : [];
  const searchInitialLoading = isSearching && search.isLoading && searchItems.length === 0;
  const searchNoResults = isSearching && !search.isLoading && searchItems.length === 0;

  return (
    <View style={styles.root}>
      {isSearching ? (
        <FlashList
          key="search"
          data={searchItems}
          numColumns={values.shelfGridColumns}
          keyExtractor={(item, index) => `${rowItemId(item)}-${index}`}
          contentContainerStyle={{
            paddingTop: headerHeight + spacing.md,
            paddingLeft: gutters.left,
            paddingRight: gutters.right,
            paddingBottom: spacing.xxl,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <View>
              {searchInitialLoading ? (
                <View style={styles.centered}>
                  <ActivityIndicator color={colors.textSecondary} />
                </View>
              ) : null}
              {searchNoResults ? (
                <View style={styles.centered}>
                  <Text style={styles.emptyTitle}>No results</Text>
                  <Text style={styles.emptyBody}>Try a different spelling or fewer words.</Text>
                </View>
              ) : null}
              {search.jellyseerrError ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerLabel} numberOfLines={2}>
                    Jellyseerr search failed — only library results are shown.
                  </Text>
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <MediaCard
                item={item}
                width={values.mediaCardWidth}
                posterHeight={values.mediaCardPosterHeight}
                gap={0}
                onPress={() => handleItemPress(item)}
              />
            </View>
          )}
        />
      ) : (
        <FlashList
          key="shelves"
          ref={scrollRestore.ref}
          onScroll={scrollRestore.onScroll}
          onContentSizeChange={scrollRestore.onContentSizeChange}
          data={visibleShelves}
          keyExtractor={(shelf) => shelf.key}
          contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            <View>
              <ConnectionBanner status={connectionStatus} />
              {anyShelfLoading && visibleShelves.length === 0 ? (
                <View style={styles.centered}>
                  <ActivityIndicator color={colors.textSecondary} />
                </View>
              ) : null}
              {allShelvesEmptyOnline ? (
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
      )}
      <FloatingBlurHeader onTotalHeightChange={handleHeaderHeightChange}>
        <View style={[styles.header, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
          <View style={styles.topRow}>
            <View style={styles.topTitleBlock}>
              <Text style={styles.title}>Jellyfuse</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                Signed in as {activeUser?.displayName ?? "Signed in"}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Switch profile (currently ${activeUser?.displayName ?? "user"})`}
              onPress={handleOpenProfiles}
              style={({ pressed }) => [
                styles.avatarButton,
                !activeUser?.avatarUrl && {
                  backgroundColor: profileColorFor(activeUser?.userId ?? "anonymous"),
                },
                pressed && styles.avatarButtonPressed,
              ]}
            >
              {activeUser?.avatarUrl ? (
                <Image
                  source={activeUser.avatarUrl}
                  style={styles.avatarImage}
                  contentFit="cover"
                  transition={duration.normal}
                  recyclingKey={activeUser.avatarUrl}
                  cachePolicy="memory-disk"
                />
              ) : (
                <Text style={styles.avatarLetter}>
                  {(activeUser?.displayName ?? "?").slice(0, 1).toUpperCase()}
                </Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              onPress={signOutAll}
              style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
            >
              <Text style={styles.signOutLabel}>Sign out</Text>
            </Pressable>
          </View>
          <SearchInput value={query} onChangeText={setQuery} onClear={() => setQuery("")} />
        </View>
      </FloatingBlurHeader>
      <StatusBarScrim />
    </View>
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

function rowItemId(item: MediaItem): string {
  switch (item.id.kind) {
    case "jellyfin":
    case "both":
      return item.id.jellyfinId;
    case "tmdb":
      return `tmdb-${item.id.tmdbId}`;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Navigation helpers
// ──────────────────────────────────────────────────────────────────────

function handleOpenProfiles() {
  router.push("/profile-picker");
}

function handleSeeAll(shelfKey: ShelfKey) {
  router.push(`/shelf/${shelfKey}`);
}

function handleItemPress(item: MediaItem) {
  const jellyfinId = mediaIdJellyfin(item.id);
  if (jellyfinId) {
    if (item.mediaType === "series") {
      router.push(`/detail/series/${jellyfinId}`);
    } else if (item.mediaType === "episode" && item.seriesId) {
      router.push(`/detail/series/${item.seriesId}`);
    } else {
      router.push(`/detail/movie/${jellyfinId}`);
    }
    return;
  }
  Alert.alert(item.title, "Requesting Jellyseerr items is coming in the next update.", [
    { text: "OK" },
  ]);
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  topRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  topTitleBlock: {
    flex: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  avatarButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    height: 36,
    justifyContent: "center",
    overflow: "hidden",
    width: 36,
  },
  avatarButtonPressed: {
    opacity: opacity.pressed,
  },
  avatarImage: {
    height: 36,
    width: 36,
  },
  avatarLetter: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
  },
  signOut: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  signOutPressed: {
    opacity: opacity.pressed,
  },
  signOutLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  cell: {
    alignItems: "center",
    paddingBottom: spacing.lg,
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
    textAlign: "center",
  },
  errorBanner: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 8,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorBannerLabel: {
    color: colors.warning,
    fontSize: fontSize.caption,
  },
});
