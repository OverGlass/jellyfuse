import type { MediaItem, ShelfPageKey } from "@jellyfuse/api";
import { mediaIdJellyfin } from "@jellyfuse/models";
import type { ShelfKey } from "@jellyfuse/query-keys";
import { colors, fontSize, fontWeight, layout, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { BackButton } from "@/features/common/components/back-button";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { MediaCard } from "@/features/home/components/media-card";
import { useShelfInfinite } from "@/services/query";
import { useBreakpoint, useScreenGutters } from "@/services/responsive";

/**
 * Virtualised grid view for a single home shelf. Reached from the
 * "See all →" chevron on `<MediaShelf>`. Uses `useInfiniteQuery` to
 * page 50 items at a time via `fetchShelfPage`. Responsive column
 * count from `useBreakpoint` (phone 3 / tablet 4 / desktop 6 — same
 * as the home grid tokens).
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
// to Phase 4 alongside the blended search work.
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

export function ShelfScreen({ shelfKey }: Props) {
  const pageable = PAGEABLE_SHELVES[shelfKey];
  const title = SHELF_TITLE[shelfKey];
  const query = useShelfInfinite(pageable ? (shelfKey as ShelfPageKey) : undefined);
  const { values } = useBreakpoint();
  const gutters = useScreenGutters();
  const insets = useSafeAreaInsets();
  const scrollRestore = useRestoredScroll(`/shelf/${shelfKey}`);

  if (!pageable) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={[styles.header, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
          <BackButton />
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.centered}>
          <Text style={styles.empty}>Not yet available</Text>
        </View>
      </SafeAreaView>
    );
  }

  const items: MediaItem[] = query.data?.pages.flatMap((p) => p.items) ?? [];
  const isInitialLoading = query.isPending;
  const isPagingLoading = query.isFetchingNextPage;
  const hasError = query.isError;
  const total = query.data?.pages[0]?.totalRecordCount ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={[styles.header, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
        <Text style={styles.title}>{title}</Text>
        {total > 0 ? <Text style={styles.count}>{total} items</Text> : null}
      </View>
      <FlashList
        ref={scrollRestore.ref}
        onScroll={scrollRestore.onScroll}
        onContentSizeChange={scrollRestore.onContentSizeChange}
        data={items}
        numColumns={values.shelfGridColumns}
        keyExtractor={(item, index) => `${keyFor(item)}-${index}`}
        contentContainerStyle={{
          paddingLeft: gutters.left,
          paddingRight: gutters.right,
          paddingTop: spacing.md,
          paddingBottom: insets.bottom + layout.screenPaddingBottom,
        }}
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
          if (query.hasNextPage && !query.isFetchingNextPage) {
            query.fetchNextPage();
          }
        }}
        ListEmptyComponent={
          !isInitialLoading && !hasError ? (
            <View style={styles.centered}>
              <Text style={styles.empty}>No items in this shelf.</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          isPagingLoading ? (
            <View style={styles.footer}>
              <ActivityIndicator color={colors.textSecondary} />
            </View>
          ) : null
        }
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
      <BackButton />
    </SafeAreaView>
  );
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
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    gap: spacing.xs,
    // Leave room for the floating BackButton — it sits at top-left
    // at y = insets.top + 8, left = gutters.left. The title starts
    // just below it on the next row, centered left within the
    // content padding.
    paddingTop: spacing.xxl,
    paddingBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.display,
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
