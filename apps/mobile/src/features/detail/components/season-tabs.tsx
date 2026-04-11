import type { MediaItem } from "@jellyfuse/api";
import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

/**
 * Horizontal segmented control for season selection on the series
 * detail screen. Pure component: takes the season list + active
 * season id, emits `onSelect` when a tab is tapped. Uses a
 * horizontally-scrolling view so 20+ seasons still navigable.
 */
interface Props {
  seasons: MediaItem[];
  activeSeasonId: string | undefined;
  onSelect: (seasonId: string) => void;
}

export function SeasonTabs({ seasons, activeSeasonId, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
    >
      {seasons.map((season) => {
        const seasonId =
          season.id.kind === "tmdb" ? `tmdb-${season.id.tmdbId}` : season.id.jellyfinId;
        const isActive = seasonId === activeSeasonId;
        const label =
          season.seasonNumber !== undefined ? `Season ${season.seasonNumber}` : season.title;
        return (
          <Pressable
            key={seasonId}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: isActive }}
            onPress={() => onSelect(seasonId)}
            style={({ pressed }) => [
              styles.tab,
              isActive && styles.tabActive,
              pressed && styles.tabPressed,
            ]}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  tab: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tabActive: {
    backgroundColor: colors.accent,
  },
  tabPressed: {
    opacity: opacity.pressed,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
  labelActive: {
    color: colors.accentContrast,
    fontWeight: fontWeight.semibold,
  },
});
