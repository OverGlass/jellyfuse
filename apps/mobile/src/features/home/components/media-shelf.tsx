import type { MediaItem } from "@jellyfuse/api";
import { colors, fontSize, fontWeight, opacity, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NerdIcon } from "@/features/common/components/nerd-icon";
import { MediaCard } from "@/features/home/components/media-card";
import { WideMediaCard } from "@/features/home/components/wide-media-card";
import { useBreakpoint, useScreenGutters } from "@/services/responsive";

/**
 * One row on the home screen — a title, an optional "See all" chevron,
 * and a horizontal FlashList of `MediaCard`s (or `WideMediaCard`s when
 * `variant === "wide"`) driven by `items`. Pure component: all data
 * in via props, navigation flows out via `onItemPress` + `onSeeAll`.
 * Parent (HomeScreen) hides the whole row when `items.length === 0`,
 * so empty states don't pollute the layout with spinners / labels.
 *
 * **Responsive**: pulls card width / height / gap from `useBreakpoint`,
 * so the same component lays out correctly on phone / tablet / desktop
 * without any parent math.
 *
 * **Variants**:
 * - `"poster"` (default) — 2:3 portrait card, for Latest / Recently
 *   Added / Next Up shelves where we want a lot of titles visible.
 * - `"wide"` — 16:9 landscape card, for Continue Watching where we
 *   want the episode thumbnail + progress bar to dominate.
 */

export type MediaShelfVariant = "poster" | "wide";

interface Props {
  title: string;
  items: MediaItem[];
  variant?: MediaShelfVariant;
  onItemPress: (item: MediaItem) => void;
  onSeeAll?: () => void;
}

export function MediaShelf({ title, items, variant = "poster", onItemPress, onSeeAll }: Props) {
  const { t } = useTranslation();
  const { values } = useBreakpoint();
  const gutters = useScreenGutters();
  return (
    <View style={styles.root}>
      <View style={[styles.headerRow, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
        <Text style={styles.title}>{title}</Text>
        {onSeeAll ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.seeAllAriaLabel", { title })}
            onPress={onSeeAll}
            style={({ pressed }) => [styles.seeAll, pressed && styles.seeAllPressed]}
          >
            <Text style={styles.seeAllLabel}>{t("common.seeAll")}</Text>
            <NerdIcon name="chevronRight" size={10} color={colors.accent} />
          </Pressable>
        ) : null}
      </View>
      <FlashList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={items}
        keyExtractor={(item, index) => `${keyFor(item)}-${index}`}
        renderItem={({ item }) =>
          variant === "wide" ? (
            <WideMediaCard
              item={item}
              width={values.wideCardWidth}
              height={values.wideCardHeight}
              gap={values.mediaCardGap}
              onPress={() => onItemPress(item)}
            />
          ) : (
            <MediaCard
              item={item}
              width={values.mediaCardWidth}
              posterHeight={values.mediaCardPosterHeight}
              gap={values.mediaCardGap}
              onPress={() => onItemPress(item)}
            />
          )
        }
        contentContainerStyle={{ paddingLeft: gutters.left, paddingRight: gutters.right }}
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
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
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
