import { ConnectionBanner } from "@/features/common/components/connection-banner";
import { FloatingBlurHeader } from "@/features/common/components/floating-blur-header";
import { PILL_TAB_CLEARANCE } from "@/features/common/components/pill-tab-bar";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { useFloatingHeaderScroll } from "@/features/common/hooks/use-floating-header-scroll";
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
import { useJellyseerrRequests } from "@/services/query/hooks/use-requests";
import { useSearchBlended } from "@/services/query/hooks/use-search-blended";
import { useScreenGutters } from "@/services/responsive";
import type { MediaItem } from "@jellyfuse/api";
import { activeRequestItems, mediaIdJellyfin, mediaRequestToMediaItem } from "@jellyfuse/models";
import type { ShelfKey } from "@jellyfuse/query-keys";
import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useDeferredValue, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<HomeShelf>);
const AnimatedSearchList = Animated.createAnimatedComponent(FlashList<SearchRow>);

/**
 * Home screen. Jellyfin shelves through RQ hooks. Search lives
 * in-place — typing ≥2 chars replaces shelves with blended results.
 *
 * **Header**: just a floating blur bar with the search input — no
 * title, no buttons. Mirrors the Rust mobile native search bar (`native_search.rs`).
 *
 * **Tab bar**: handled by the `PillTabBar` floating above the content.
 * Scroll containers use `PILL_TAB_CLEARANCE + insets.bottom` as bottom
 * padding so the last item stays visible above the pill.
 *
 * Shelf order: Continue Watching → Next Up → Recently Added →
 * Latest Movies → Latest TV → My Requests (Jellyseerr connected).
 */
const MIN_SEARCH_LENGTH = 2;

export function HomeScreen() {
  useKeepAwake();

  const insets = useSafeAreaInsets();
  const { jellyseerrStatus } = useAuth();
  const gutters = useScreenGutters();
  const connectionStatus = useConnectionStatus();
  const scrollRestore = useRestoredScroll("/home");

  const [query, setQuery] = useState("");
  const { headerHeight, onHeaderHeightChange, scrollY, backdropStyle } = useFloatingHeaderScroll();
  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.trim();
  const isSearching = trimmedQuery.length >= MIN_SEARCH_LENGTH;
  const search = useSearchBlended(deferredQuery);

  // Custom scroll handler: updates the shared `scrollY` from the hook
  // (so the backdrop blur fade is driven) AND pipes the offset into
  // `useRestoredScroll` so returning to the home tab restores the
  // previous position.
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
      scheduleOnRN(scrollRestore.setOffset, event.contentOffset.y);
    },
  });

  const continueWatching = useContinueWatching();
  const nextUp = useNextUp();
  const recentlyAdded = useRecentlyAdded();
  const latestMovies = useLatestMovies();
  const latestTv = useLatestTv();

  const requestsQuery = useJellyseerrRequests();
  const requestItems =
    jellyseerrStatus === "connected"
      ? activeRequestItems(requestsQuery.data ?? []).map(mediaRequestToMediaItem)
      : [];

  const shelves: HomeShelf[] = [
    {
      key: "continue-watching",
      title: "Continue Watching",
      variant: "wide",
      query: continueWatching,
      onItemPress: handleContinueWatchingPress,
    },
    { key: "next-up", title: "Next Up", variant: "poster", query: nextUp },
    { key: "recently-added", title: "Recently Added", variant: "poster", query: recentlyAdded },
    { key: "latest-movies", title: "Latest Movies", variant: "poster", query: latestMovies },
    { key: "latest-tv", title: "Latest TV", variant: "poster", query: latestTv },
    { key: "requests", title: "My Requests", variant: "poster", items: requestItems },
  ];

  const visibleShelves = shelves.filter((shelf) => {
    if (shelf.items !== undefined) return shelf.items.length > 0;
    return shelf.query?.isPending || (shelf.query?.data?.length ?? 0) > 0;
  });

  const anyShelfLoading = shelves.some((s) => s.query?.isPending);
  const allShelvesEmptyOnline =
    !anyShelfLoading &&
    connectionStatus === "online" &&
    shelves.every((s) => (s.items?.length ?? s.query?.data?.length ?? 0) === 0);

  const searchRows: SearchRow[] = isSearching ? buildSearchRows(search.data) : [];
  const searchInitialLoading = isSearching && search.isLoading && searchRows.length === 0;
  const searchNoResults = isSearching && !search.isLoading && searchRows.length === 0;

  // Bottom padding keeps the last item above the floating pill tab bar.
  // Pill sits at `(insets.bottom > 0 ? insets.bottom - 8 : 8)` from the
  // screen edge; PILL_TAB_CLEARANCE covers the pill height + breathing room.
  const pillBottom = insets.bottom > 0 ? insets.bottom - 8 : 8;
  const listPaddingBottom = pillBottom + PILL_TAB_CLEARANCE;

  return (
    <View style={styles.root}>
      {isSearching ? (
        <AnimatedSearchList
          key="search"
          data={searchRows}
          keyExtractor={(row) => row.id}
          getItemType={(row) => row.kind}
          contentContainerStyle={{
            paddingTop: headerHeight,
            paddingBottom: listPaddingBottom,
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
          contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: listPaddingBottom }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={scrollHandler}
          scrollEventThrottle={16}
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
              items={item.items ?? item.query?.data ?? []}
              variant={item.variant}
              onItemPress={item.onItemPress ?? handleItemPress}
              onSeeAll={() => handleSeeAll(item.key)}
            />
          )}
          ItemSeparatorComponent={null}
        />
      )}

      {/*
       * Floating header — just the search bar, no title, no buttons.
       * Mirrors the Rust native UISearchBar overlay (`native_search.rs`).
       * The blur fades in from transparent as the user scrolls past 60 dp.
       */}
      <FloatingBlurHeader backdropStyle={backdropStyle} onTotalHeightChange={onHeaderHeightChange}>
        <View style={{ paddingHorizontal: gutters.left }}>
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
  query?: {
    data: MediaItem[] | undefined;
    isPending: boolean;
  };
  items?: MediaItem[];
  onItemPress?: (item: MediaItem) => void;
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

function handleSeeAll(shelfKey: ShelfKey) {
  if (shelfKey === "requests") {
    router.push("/requests");
  } else {
    router.push(`/shelf/${shelfKey}`);
  }
}

function handleContinueWatchingPress(item: MediaItem) {
  const jellyfinId = mediaIdJellyfin(item.id);
  if (jellyfinId) {
    router.push(`/player/${jellyfinId}`);
  }
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
  if (item.id.kind === "tmdb") {
    const mediaType = item.mediaType === "series" ? "tv" : "movie";
    router.push({
      pathname: "/detail/tmdb/[tmdbId]",
      params: { tmdbId: String(item.id.tmdbId), mediaType },
    });
  }
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
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
