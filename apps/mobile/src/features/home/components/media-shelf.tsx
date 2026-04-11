import type { MediaItem } from "@jellyfuse/api";
import { colors, fontSize, fontWeight, opacity, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MediaCard } from "@/features/home/components/media-card";
import { useBreakpoint } from "@/services/responsive";

/**
 * One row on the home screen — a title, an optional "See all" chevron,
 * and a horizontal FlashList of `MediaCard`s driven by `items`. Pure
 * component: all data in via props, navigation flows out via the
 * `onItemPress` + `onSeeAll` callbacks. Parent (HomeScreen) hides the
 * whole row when `items.length === 0`, so empty states don't pollute
 * the layout with spinners / labels.
 *
 * **Responsive**: pulls card width / height / gap from `useBreakpoint`,
 * so the same component lays out correctly on phone / tablet / desktop
 * without any parent math.
 */
interface Props {
  title: string;
  items: MediaItem[];
  onItemPress: (item: MediaItem) => void;
  onSeeAll?: () => void;
}

export function MediaShelf({ title, items, onItemPress, onSeeAll }: Props) {
  const { values } = useBreakpoint();
  return (
    <View style={styles.root}>
      <View style={[styles.headerRow, { paddingHorizontal: values.screenPaddingHorizontal }]}>
        <Text style={styles.title}>{title}</Text>
        {onSeeAll ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`See all ${title}`}
            onPress={onSeeAll}
            style={({ pressed }) => [styles.seeAll, pressed && styles.seeAllPressed]}
          >
            <Text style={styles.seeAllLabel}>See all →</Text>
          </Pressable>
        ) : null}
      </View>
      <FlashList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={items}
        keyExtractor={(item, index) => `${keyFor(item)}-${index}`}
        renderItem={({ item }) => (
          <MediaCard
            item={item}
            width={values.mediaCardWidth}
            posterHeight={values.mediaCardPosterHeight}
            gap={values.mediaCardGap}
            onPress={() => onItemPress(item)}
          />
        )}
        contentContainerStyle={{ paddingHorizontal: values.screenPaddingHorizontal }}
      />
    </View>
  );
}

function keyFor(item: MediaItem): string {
  switch (item.id.kind) {
    case "jellyfin":
    case "both":
      return item.id.jellyfinId;
    case "tmdb":
      return `tmdb-${item.id.tmdbId}`;
  }
}

const styles = StyleSheet.create({
  root: {
    paddingVertical: spacing.md,
  },
  headerRow: {
    alignItems: "baseline",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.semibold,
  },
  seeAll: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  seeAllPressed: {
    opacity: opacity.pressed,
  },
  seeAllLabel: {
    color: colors.accent,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
});
