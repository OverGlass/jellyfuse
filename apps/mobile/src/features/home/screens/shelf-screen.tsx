import type { MediaItem, ShelfPageKey } from "@jellyfuse/api";
import { mediaIdJellyfin } from "@jellyfuse/models";
import type { ShelfKey } from "@jellyfuse/query-keys";
import { colors, fontSize, layout, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { useDeferredValue, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeader } from "@/features/common/components/screen-header";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { MediaCard } from "@/features/home/components/media-card";
import { SearchInput } from "@/features/search/components/search-input";
import { useShelfInfinite } from "@/services/query";
import { useSearchBlended } from "@/services/query/hooks/use-search-blended";
import { useBreakpoint, useScreenGutters } from "@/services/responsive";

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<MediaItem>);

/**
 * Virtualised grid view for a single home shelf. Reached from the
 * "See all" chevron on `<MediaShelf>`. Uses `useInfiniteQuery` to
 * page items via `fetchShelfPage`. Responsive column count from
 * `useBreakpoint` (phone 3 / tablet 4 / desktop 6).
 *
 * Shares the same `ScreenHeader` pattern as the home screen — small
 * back button + title row, search input below, native-driven blur
 * backdrop that fades in as the user scrolls. Keeps the visual
 * vocabulary identical across screens.
 *
 * **Per-shelf search**, ported from Rust `ShelfGridView` in
 * `crates/jf-ui-kit/src/views/shelf_grid.rs`:
 *
 * - `STATIC_SHELVES` (continue-watching, next-up, recently-added):
 *   client-side substring filter on the loaded items. No HTTP.
 * - `latest-movies`: server-side blended search constrained to
 *   `IncludeItemTypes=Movie` + a `typeFilter='movie'` post-blend.
 * - `latest-tv`: server-side blended search constrained to
 *   `IncludeItemTypes=Series` + a `typeFilter='series'` post-blend.
 *
 * Pure component: takes a `ShelfKey` in and renders the corresponding
 * paginated list.
 */

interface Props {
  shelfKey: ShelfKey;
}

const PAGEABLE_SHELVES: Record<ShelfKey, boolean> = {
  "continue-watching": true,
  "next-up": true,
  "recently-added": true,
  "latest-movies": true,
  "latest-tv": true,
  suggestions: false,
};

const SHELF_TITLE: Record<ShelfKey, string> = {
  "continue-watching": "Continue Watching",
  "next-up": "Next Up",
  "recently-added": "Recently Added",
  "latest-movies": "Latest Movies",
  "latest-tv": "Latest TV",
  suggestions: "Suggestions",
};

type ShelfSearchMode =
  | { kind: "static" }
  | { kind: "library"; includeTypes: "Movie" | "Series"; typeFilter: "movie" | "series" };

const SHELF_SEARCH_MODE: Record<ShelfKey, ShelfSearchMode> = {
  "continue-watching": { kind: "static" },
  "next-up": { kind: "static" },
  "recently-added": { kind: "static" },
  "latest-movies": { kind: "library", includeTypes: "Movie", typeFilter: "movie" },
  "latest-tv": { kind: "library", includeTypes: "Series", typeFilter: "series" },
  suggestions: { kind: "static" },
};

const MIN_SEARCH_LENGTH = 2;
const BLUR_FADE_END = 60;

export function ShelfScreen({ shelfKey }: Props) {
  const pageable = PAGEABLE_SHELVES[shelfKey];
  const title = SHELF_TITLE[shelfKey];
  const searchMode = SHELF_SEARCH_MODE[shelfKey];
  const query = useShelfInfinite(pageable ? (shelfKey as ShelfPageKey) : undefined);
  const { values } = useBreakpoint();
  const gutters = useScreenGutters();
  const insets = useSafeAreaInsets();
  const scrollRestore = useRestoredScroll(`/shelf/${shelfKey}`);

  const [searchQuery, setSearchQuery] = useState("");
  const [headerHeight, setHeaderHeight] = useState(0);
  function handleHeaderHeightChange(next: number) {
    if (Math.abs(next - headerHeight) > 0.5) {
      setHeaderHeight(next);
    }
  }
  const deferredQuery = useDeferredValue(searchQuery);
  const trimmedQuery = deferredQuery.trim();
  const isSearching = trimmedQuery.length >= MIN_SEARCH_LENGTH;
  const isLibrarySearch = isSearching && searchMode.kind === "library";

  const librarySearch = useSearchBlended(
    isLibrarySearch ? deferredQuery : "",
    searchMode.kind === "library"
      ? { includeTypes: searchMode.includeTypes, typeFilter: searchMode.typeFilter }
      : {},
  );

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

  if (!pageable) {
    return (
      <View style={styles.root}>
        <View style={[styles.centered, { paddingTop: headerHeight + spacing.xxl }]}>
          <Text style={styles.empty}>Not yet available</Text>
        </View>
        <ScreenHeader
          showBack
          title={title}
          backdropStyle={blurBackdropStyle}
          onTotalHeightChange={handleHeaderHeightChange}
        />
        <StatusBarScrim />
      </View>
    );
  }

  const allItems: MediaItem[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  const isInitialLoading = query.isPending;
  const isPagingLoading = query.isFetchingNextPage;
  const hasError = query.isError;

  let displayed: MediaItem[];
  let isSearchLoading = false;
  if (!isSearching) {
    displayed = allItems;
  } else if (searchMode.kind === "library") {
    const data = librarySearch.data;
    displayed = data ? [...data.libraryItems, ...data.requestableItems] : [];
    isSearchLoading = librarySearch.isLoading;
  } else {
    displayed = filterStaticItems(allItems, trimmedQuery);
  }

  return (
    <View style={styles.root}>
      <AnimatedFlashList
        ref={scrollRestore.ref}
        onContentSizeChange={scrollRestore.onContentSizeChange}
        data={displayed}
        numColumns={values.shelfGridColumns}
        keyExtractor={(item, index) => `${keyFor(item)}-${index}`}
        contentContainerStyle={{
          paddingLeft: gutters.left,
          paddingRight: gutters.right,
          paddingTop: headerHeight + spacing.md,
          paddingBottom: insets.bottom + layout.screenPaddingBottom,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={scrollHandler}
        scrollEventThrottle={16}
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
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (!isSearching && query.hasNextPage && !query.isFetchingNextPage) {
            query.fetchNextPage();
          }
        }}
        ListEmptyComponent={
          !isInitialLoading && !isSearchLoading && !hasError ? (
            <View style={styles.centered}>
              <Text style={styles.empty}>
                {isSearching ? "No results" : "No items in this shelf."}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          isPagingLoading || isSearchLoading ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : null
        }
      />
      <ScreenHeader
        showBack
        title={title}
        bottomSlot={
          <SearchInput
            value={searchQuery}
            placeholder={`Search ${title}`}
            onChangeText={setSearchQuery}
            onClear={() => setSearchQuery("")}
          />
        }
        backdropStyle={blurBackdropStyle}
        onTotalHeightChange={handleHeaderHeightChange}
      />
      {isInitialLoading ? (
        <View style={styles.overlay}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : null}
      {hasError ? (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>Couldn't load this shelf</Text>
          <Text style={styles.errorBody}>
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </Text>
        </View>
      ) : null}
      <StatusBarScrim />
    </View>
  );
}

function filterStaticItems(items: MediaItem[], query: string): MediaItem[] {
  const q = query.toLowerCase();
  return items.filter((item) => {
    if (item.title.toLowerCase().includes(q)) return true;
    if (item.seriesName && item.seriesName.toLowerCase().includes(q)) return true;
    return false;
  });
}

function keyFor(item: MediaItem): string {
  return item.id.kind === "tmdb" ? `tmdb-${item.id.tmdbId}` : item.id.jellyfinId;
}

function handleItemPress(item: MediaItem) {
  const jellyfinId = mediaIdJellyfin(item.id);
  if (!jellyfinId) return;
  if (item.mediaType === "series") {
    router.push(`/detail/series/${jellyfinId}`);
  } else if (item.mediaType === "episode" && item.seriesId) {
    router.push(`/detail/series/${item.seriesId}`);
  } else {
    router.push(`/detail/movie/${jellyfinId}`);
  }
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  cell: {
    alignItems: "center",
    paddingBottom: spacing.lg,
  },
  footer: {
    alignItems: "center",
    paddingVertical: spacing.lg,
  },
  centered: {
    alignItems: "center",
    paddingVertical: spacing.xxl,
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
  },
  overlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
  },
  errorBody: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});
