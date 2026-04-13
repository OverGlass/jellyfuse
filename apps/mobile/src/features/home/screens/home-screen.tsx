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
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { ConnectionBanner } from "@/features/common/components/connection-banner";
import { ScreenHeader } from "@/features/common/components/screen-header";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { MediaShelf, type MediaShelfVariant } from "@/features/home/components/media-shelf";
import { SearchInput } from "@/features/search/components/search-input";
import { SearchResultRow } from "@/features/search/components/search-result-row";
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
import { useScreenGutters } from "@/services/responsive";

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<HomeShelf>);
const AnimatedSearchList = Animated.createAnimatedComponent(FlashList<SearchRow>);

/**
 * Home screen. Real Jellyfin shelves wired through the
 * `@jellyfuse/api` fetchers + RQ hooks. Responsive from day 1:
 * `useBreakpoint()` drives the screen padding, card sizing, and
 * search-results column count, so the same layout works on phone /
 * iPad / Mac Catalyst / Android TV without per-platform branches.
 *
 * **Search lives here**, not on a separate route. A pinned search
 * bar in the `ScreenHeader` drives `useSearchBlended`. Once the
 * user types two or more characters, the shelves are replaced
 * inline with a responsive grid of MediaCards built from the
 * blended Jellyfin + Jellyseerr results; clearing the input
 * restores the shelves. Mirrors the Rust `HomeView` in
 * `crates/jf-ui-kit/src/views/home.rs` which uses the same
 * in-place swap and a flex-wrap grid of cards.
 *
 * **Scroll choreography**, native-driven via Reanimated:
 * - The blur backdrop on the floating header fades from 0 → 1 as
 *   the user scrolls 0 → 60 dp, so the header reads as transparent
 *   at the top of the page and as a frosted bar once content
 *   begins to slide under it.
 * - The in-flow "welcome back" hero block dissolves and slides
 *   slightly upward as it scrolls past, so the transition into
 *   "small header pinned + content" feels like a natural shrink
 *   rather than a hard swap.
 * - Both come from a single `useAnimatedScrollHandler` worklet
 *   that mirrors the scrolled offset into a `SharedValue`, then
 *   into two `useAnimatedStyle` hooks. No `setState` in the scroll
 *   path, no `useEffect`.
 *
 * Shelf order (from the plan): Continue Watching → Next Up →
 * Recently Added → Latest Movies → Latest TV. Suggestions stays
 * deferred to a later phase (Jellyseerr-backed).
 */
const MIN_SEARCH_LENGTH = 2;
const HERO_FADE_END = 60;
const BLUR_FADE_END = 60;

export function HomeScreen() {
  useKeepAwake();

  const { activeUser, signOutAll } = useAuth();
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

  // Native-driven scroll position. Single shared value feeds both
  // the blur backdrop fade and the in-flow hero scroll-fade.
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
      scheduleOnRN(scrollRestore.setOffset, event.contentOffset.y);
    },
  });

  const blurBackdropStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: interpolate(scrollY.value, [0, BLUR_FADE_END], [0, 1], Extrapolation.CLAMP),
    };
  });

  const heroStyle = useAnimatedStyle(() => {
    "worklet";
    const opacity = interpolate(scrollY.value, [0, HERO_FADE_END], [1, 0], Extrapolation.CLAMP);
    const translateY = interpolate(
      scrollY.value,
      [0, HERO_FADE_END],
      [0, -16],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ translateY }] };
  });

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

  // Search results render as inline rows (poster + title + overview
  // + Library/Request badge), grouped under section headers — same
  // as the standalone search screen we briefly had. Library items
  // come first, then requestables. Empty sections collapse.
  const searchRows: SearchRow[] = isSearching ? buildSearchRows(search.data) : [];
  const searchInitialLoading = isSearching && search.isLoading && searchRows.length === 0;
  const searchNoResults = isSearching && !search.isLoading && searchRows.length === 0;

  const greeting = activeUser?.displayName
    ? `Welcome back, ${activeUser.displayName}`
    : "Welcome back";

  const heroBlock = (
    <Animated.View style={heroStyle}>
      <View style={[styles.hero, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
        <Text style={styles.greeting} numberOfLines={1}>
          {greeting}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          onPress={signOutAll}
          style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
        >
          <Text style={styles.signOutLabel}>Sign out</Text>
        </Pressable>
      </View>
      <ConnectionBanner status={connectionStatus} />
    </Animated.View>
  );

  return (
    <View style={styles.root}>
      {isSearching ? (
        <AnimatedSearchList
          key="search"
          data={searchRows}
          keyExtractor={(row) => row.id}
          getItemType={(row) => row.kind}
          contentContainerStyle={{
            paddingTop: headerHeight + spacing.md,
            paddingBottom: spacing.xxl,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={scrollHandler}
          scrollEventThrottle={16}
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
                <View
                  style={[
                    styles.errorBanner,
                    { marginLeft: gutters.left, marginRight: gutters.right },
                  ]}
                >
                  <Text style={styles.errorBannerLabel} numberOfLines={2}>
                    Jellyseerr search failed — only library results are shown.
                  </Text>
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return <SectionHeader title={item.title} />;
            }
            return <SearchResultRow item={item.item} onPress={() => handleItemPress(item.item)} />;
          }}
        />
      ) : (
        <AnimatedFlashList
          key="shelves"
          ref={scrollRestore.ref}
          onContentSizeChange={scrollRestore.onContentSizeChange}
          data={visibleShelves}
          keyExtractor={(shelf) => shelf.key}
          contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: spacing.xxl }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          ListHeaderComponent={
            <View>
              {heroBlock}
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
      <ScreenHeader
        title="Jellyfuse"
        rightSlot={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Switch profile (currently ${activeUser?.displayName ?? "user"})`}
            onPress={handleOpenProfiles}
            style={({ pressed }) => [
              styles.avatarButton,
              !activeUser?.avatarUrl && {
                backgroundColor: profileColorFor(activeUser?.userId ?? "anonymous"),
              },
              pressed && styles.pressed,
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
        }
        bottomSlot={
          <SearchInput value={query} onChangeText={setQuery} onClear={() => setQuery("")} />
        }
        backdropStyle={blurBackdropStyle}
        onTotalHeightChange={handleHeaderHeightChange}
      />
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

// ──────────────────────────────────────────────────────────────────────
// Search row flattening + section header
// ──────────────────────────────────────────────────────────────────────

type SearchRow =
  | { kind: "header"; id: string; title: string }
  | { kind: "item"; id: string; item: MediaItem };

function buildSearchRows(
  data: { libraryItems: MediaItem[]; requestableItems: MediaItem[] } | null,
): SearchRow[] {
  if (!data) return [];
  const rows: SearchRow[] = [];
  if (data.libraryItems.length > 0) {
    rows.push({ kind: "header", id: "header:library", title: "In your library" });
    for (const item of data.libraryItems) {
      rows.push({ kind: "item", id: `lib:${rowItemId(item)}`, item });
    }
  }
  if (data.requestableItems.length > 0) {
    rows.push({ kind: "header", id: "header:request", title: "Request via Jellyseerr" });
    for (const item of data.requestableItems) {
      rows.push({ kind: "item", id: `req:${rowItemId(item)}`, item });
    }
  }
  return rows;
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

interface SectionHeaderProps {
  title: string;
}

function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderLabel}>{title}</Text>
    </View>
  );
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
  // TMDB-only result — open the Jellyseerr request flow modal.
  // Movies use Radarr profiles, series use Sonarr.
  if (item.id.kind === "tmdb") {
    const mediaType = item.mediaType === "series" ? "tv" : "movie";
    router.push({
      pathname: "/request/[tmdbId]",
      params: {
        tmdbId: String(item.id.tmdbId),
        mediaType,
        title: item.title,
      },
    });
  }
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  hero: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  greeting: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
  },
  signOut: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  signOutLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  pressed: {
    opacity: opacity.pressed,
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
  avatarImage: {
    height: 36,
    width: 36,
  },
  avatarLetter: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
  },
  sectionHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionHeaderLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
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
