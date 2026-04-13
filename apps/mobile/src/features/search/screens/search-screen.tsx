import type { MediaItem } from "@jellyfuse/api";
import { mediaIdJellyfin } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, opacity, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { useDeferredValue, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FloatingBlurHeader } from "@/features/common/components/floating-blur-header";
import { NerdIcon } from "@/features/common/components/nerd-icon";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { SearchInput } from "@/features/search/components/search-input";
import { SearchResultRow } from "@/features/search/components/search-result-row";
import { useSearchBlended } from "@/services/query/hooks/use-search-blended";
import { useScreenGutters } from "@/services/responsive";

/**
 * Phase 4b search screen. Top-aligned input + scrollable blended
 * results from `useSearchBlended` (Jellyfin + Jellyseerr, deduped
 * upstream by TMDB id).
 *
 * Pacing: instead of a setTimeout debounce, we feed the input through
 * React 19's `useDeferredValue`. The deferred value lags behind the
 * live input during fast keystrokes and catches up the moment the
 * scheduler has time — same UX as a 200–300 ms debounce, no timers,
 * no `useEffect`. The query is then `enabled` on the deferred value
 * being long enough.
 *
 * Sections: results render as a single flat FlashList with two
 * inline section headers ("In your library" / "Request via
 * Jellyseerr"). Empty sections collapse, so a search that returns
 * library results only doesn't show an empty Request header. The
 * row's `onPress` resolves the right detail route by id kind:
 * - `jellyfin` / `both` → `/detail/movie/{id}` or `/detail/series/{id}`
 * - `tmdb`-only         → an alert until ARK-23 wires the request flow
 *
 * No `useEffect`, no `useMemo`, no `useCallback` — React Compiler
 * handles memoisation for derived rows + section flattening.
 */
export function SearchScreen() {
  const gutters = useScreenGutters();
  const [query, setQuery] = useState("");
  const [headerHeight, setHeaderHeight] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const trimmed = deferredQuery.trim();
  const result = useSearchBlended(deferredQuery);

  const rows: SearchRow[] = buildRows(result.data?.libraryItems, result.data?.requestableItems);
  const showInitialLoading = trimmed.length >= 2 && result.isLoading && rows.length === 0;
  const showEmptyHint = trimmed.length === 0;
  const showShortQueryHint = trimmed.length > 0 && trimmed.length < 2;
  const showNoResults = trimmed.length >= 2 && !result.isLoading && rows.length === 0;

  function handleHeaderLayout(event: LayoutChangeEvent) {
    const next = event.nativeEvent.layout.height;
    if (Math.abs(next - headerHeight) > 0.5) {
      setHeaderHeight(next);
    }
  }

  return (
    <View style={styles.root}>
      <FlashList
        data={rows}
        keyExtractor={rowKey}
        getItemType={(row) => row.kind}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: spacing.xxl }}
        renderItem={({ item }) => {
          if (item.kind === "header") {
            return <SectionHeader title={item.title} />;
          }
          return <SearchResultRow item={item.item} onPress={() => handleItemPress(item.item)} />;
        }}
        ListHeaderComponent={
          <View>
            {result.jellyseerrError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerLabel} numberOfLines={2}>
                  Jellyseerr search failed — only library results are shown.
                </Text>
              </View>
            ) : null}
            {showInitialLoading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.textSecondary} />
              </View>
            ) : null}
            {showEmptyHint ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>Find something to watch</Text>
                <Text style={styles.emptyBody}>Search your library and Jellyseerr together.</Text>
              </View>
            ) : null}
            {showShortQueryHint ? (
              <View style={styles.centered}>
                <Text style={styles.emptyBody}>Type at least two characters.</Text>
              </View>
            ) : null}
            {showNoResults ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>No results</Text>
                <Text style={styles.emptyBody}>Try a different spelling or fewer words.</Text>
              </View>
            ) : null}
          </View>
        }
      />
      <FloatingBlurHeader>
        <View
          onLayout={handleHeaderLayout}
          style={[styles.header, { paddingLeft: gutters.left, paddingRight: gutters.right }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          >
            <NerdIcon name="chevronLeft" size={18} />
          </Pressable>
          <View style={styles.inputWrap}>
            <SearchInput value={query} onChangeText={setQuery} onClear={() => setQuery("")} />
          </View>
        </View>
      </FloatingBlurHeader>
      <StatusBarScrim />
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Row flattening
// ──────────────────────────────────────────────────────────────────────

type SearchRow =
  | { kind: "header"; id: string; title: string }
  | { kind: "item"; id: string; item: MediaItem };

function buildRows(
  library: MediaItem[] | undefined,
  requestable: MediaItem[] | undefined,
): SearchRow[] {
  const rows: SearchRow[] = [];
  if (library && library.length > 0) {
    rows.push({ kind: "header", id: "header:library", title: "In your library" });
    for (const item of library) {
      rows.push({ kind: "item", id: `lib:${itemId(item)}`, item });
    }
  }
  if (requestable && requestable.length > 0) {
    rows.push({ kind: "header", id: "header:request", title: "Request via Jellyseerr" });
    for (const item of requestable) {
      rows.push({ kind: "item", id: `req:${itemId(item)}`, item });
    }
  }
  return rows;
}

function itemId(item: MediaItem): string {
  switch (item.id.kind) {
    case "jellyfin":
    case "both":
      return item.id.jellyfinId;
    case "tmdb":
      return `tmdb-${item.id.tmdbId}`;
  }
}

function rowKey(row: SearchRow): string {
  return row.id;
}

// ──────────────────────────────────────────────────────────────────────
// Tap handling
// ──────────────────────────────────────────────────────────────────────

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
  // TMDB-only item — request flow lands in ARK-23. For now, surface a
  // small alert so the user knows the tap registered and the feature
  // is on the way.
  Alert.alert(item.title, "Requesting Jellyseerr items is coming in the next update.", [
    { text: "OK" },
  ]);
}

// ──────────────────────────────────────────────────────────────────────
// Inline section header
// ──────────────────────────────────────────────────────────────────────

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

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  back: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  backPressed: {
    opacity: opacity.pressed,
  },
  inputWrap: {
    flex: 1,
  },
  centered: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
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
  errorBanner: {
    backgroundColor: colors.surfaceElevated,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  errorBannerLabel: {
    color: colors.warning,
    fontSize: fontSize.caption,
  },
});
