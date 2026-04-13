import type { MediaItem, ShelfPageKey } from "@jellyfuse/api";
import { mediaIdJellyfin } from "@jellyfuse/models";
import type { ShelfKey } from "@jellyfuse/query-keys";
import { colors, fontSize, fontWeight, layout, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { useDeferredValue, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackButton } from "@/features/common/components/back-button";
import { FloatingBlurHeader } from "@/features/common/components/floating-blur-header";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { MediaCard } from "@/features/home/components/media-card";
import { SearchInput } from "@/features/search/components/search-input";
import { useShelfInfinite } from "@/services/query";
import { useSearchBlended } from "@/services/query/hooks/use-search-blended";
import { useBreakpoint, useScreenGutters } from "@/services/responsive";

/**
 * Virtualised grid view for a single home shelf. Reached from the
 * "See all →" chevron on `<MediaShelf>`. Uses `useInfiniteQuery` to
 * page 50 items at a time via `fetchShelfPage`. Responsive column
 * count from `useBreakpoint` (phone 3 / tablet 4 / desktop 6 — same
 * as the home grid tokens).
 *
 * **Per-shelf search**, ported from Rust `ShelfGridView` in
 * `crates/jf-ui-kit/src/views/shelf_grid.rs`:
 *
 * - `STATIC_SHELVES` (continue-watching, next-up): client-side
 *   substring filter on the loaded items. No HTTP, instant.
 * - `MOVIE_SHELVES` (latest-movies): server-side blended search
 *   constrained to `IncludeItemTypes=Movie`.
 * - `SERIES_SHELVES` (latest-tv): server-side blended search
 *   constrained to `IncludeItemTypes=Series`.
 * - `recently-added`: client-side filter (stays on whatever pages
 *   the user has paged in, like the Rust static behaviour).
 *
 * The pinned floating blur header carries the shelf title and the
 * search input. The FlashList content is padded by the measured
 * header height so nothing renders behind the blur on mount.
 *
 * Pure component: takes a `ShelfKey` in and renders the corresponding
 * paginated list. Error / empty / loading states handled inline —
 * parents (the route wrapper) don't deal with any of them.
 */

interface Props {
  shelfKey: ShelfKey;
}

// "suggestions" lives on Jellyseerr and doesn't page through the
// `/Users/{uid}/Items` endpoint like the other shelves — defer it
// to a later phase alongside the requests work.
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

  // Library search hook is always called; `enabled` inside is gated
  // on the trimmed query length, so the query is dormant when the
  // user isn't actively searching a library shelf.
  const librarySearch = useSearchBlended(
    isLibrarySearch ? deferredQuery : "",
    searchMode.kind === "library"
      ? { includeTypes: searchMode.includeTypes, typeFilter: searchMode.typeFilter }
      : {},
  );

  if (!pageable) {
    return (
      <View style={styles.root}>
        <FloatingBlurHeader onTotalHeightChange={handleHeaderHeightChange}>
          <View style={[styles.header, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
            <Text style={styles.title}>{title}</Text>
          </View>
        </FloatingBlurHeader>
        <View style={[styles.centered, { paddingTop: headerHeight + spacing.xxl }]}>
          <Text style={styles.empty}>Not yet available</Text>
        </View>
        <BackButton />
      </View>
    );
  }

  const allItems: MediaItem[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  const isInitialLoading = query.isPending;
  const isPagingLoading = query.isFetchingNextPage;
  const hasError = query.isError;
  const total = query.data?.pages[0]?.totalRecordCount ?? 0;

  // Decide which list to render below the header. Three cases:
  //   1. No active search — paged shelf items + infinite scroll.
  //   2. Library search — server-side blended results.
  //   3. Static search — client-side substring filter on `allItems`.
  let displayed: MediaItem[];
  let displayedTotal: number;
  let isSearchLoading = false;
  if (!isSearching) {
    displayed = allItems;
    displayedTotal = total;
  } else if (searchMode.kind === "library") {
    const data = librarySearch.data;
    displayed = data ? [...data.libraryItems, ...data.requestableItems] : [];
    displayedTotal = displayed.length;
    isSearchLoading = librarySearch.isLoading;
  } else {
    displayed = filterStaticItems(allItems, trimmedQuery);
    displayedTotal = displayed.length;
  }

  return (
    <View style={styles.root}>
      <FlashList
        ref={scrollRestore.ref}
        onScroll={scrollRestore.onScroll}
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
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
          // Disable infinite scroll while searching — the search hook
          // already returned the first 25 results and paging beyond
          // that requires a second `useSearchBlended` call (deferred).
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
      <FloatingBlurHeader onTotalHeightChange={handleHeaderHeightChange}>
        <View style={[styles.header, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            {displayedTotal > 0 ? <Text style={styles.count}>{displayedTotal} items</Text> : null}
          </View>
          <SearchInput
            value={searchQuery}
            placeholder={`Search ${title}`}
            onChangeText={setSearchQuery}
            onClear={() => setSearchQuery("")}
          />
        </View>
      </FloatingBlurHeader>
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
      <BackButton />
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
  header: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingTop: spacing.xxl,
  },
  titleRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
  },
  count: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
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
