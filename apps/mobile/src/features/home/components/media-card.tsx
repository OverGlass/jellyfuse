import type { MediaItem } from "@jellyfuse/api";
import { episodeLabel } from "@jellyfuse/models";
import { colors, duration, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { UnplayedCornerBadge } from "@/features/common/components/unplayed-corner-badge";

/**
 * Poster + title + subtitle card used in every home shelf. Pure component:
 * props in, `onPress` / `onLongPress` callbacks out, no reach into parent
 * state.
 *
 * **Responsive**: `width` + `posterHeight` are passed in from the parent
 * shelf (which reads them from `useBreakpoint()`). The card is otherwise
 * size-agnostic, which lets phone / tablet / desktop share the same
 * component with different footprints.
 *
 * Subtitle is the Jellyfin episode label (`"S2 · E4"`) for episodes,
 * otherwise the release year. Falls back to a surface-colored placeholder
 * when `item.posterUrl` is missing (deleted artwork, fresh libraries).
 *
 * An `<UnplayedCornerBadge />` overlays the top-right of the poster when
 * `item.userData.played === false` so unwatched items are scannable in
 * a shelf without opening the detail screen.
 */

interface Props {
  item: MediaItem;
  /** Card width + poster height come from `useBreakpoint().values`. */
  width: number;
  posterHeight: number;
  /** Horizontal gap between this card and the next one in the shelf row. */
  gap: number;
  onPress: () => void;
  /** Long-press opens the per-item action sheet (Mark Played, …). */
  onLongPress?: () => void;
}

export function MediaCard({ item, width, posterHeight, gap, onPress, onLongPress }: Props) {
  const subtitle = episodeLabel(item) ?? (item.year !== undefined ? String(item.year) : "");
  const accessibilityLabel = subtitle ? `${item.title}, ${subtitle}` : item.title;
  const progress = item.progress ?? 0;
  const hasProgress = progress > 0.01;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.root,
        { width, marginRight: gap },
        pressed && styles.rootPressed,
      ]}
    >
      <View style={[styles.posterWrap, { width, height: posterHeight }]}>
        {item.posterUrl ? (
          <Image
            source={item.posterUrl}
            style={[styles.poster, { width, height: posterHeight }]}
            contentFit="cover"
            transition={duration.normal}
            recyclingKey={item.posterUrl}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.poster, styles.posterFallback, { width, height: posterHeight }]}>
            <Text style={styles.posterFallbackGlyph}>{item.title.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        {hasProgress ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
        <UnplayedCornerBadge
          played={item.userData?.played}
          progress={item.progress}
          playCount={item.userData?.playCount}
          unplayedItemCount={item.userData?.unplayedItemCount}
          episodeCount={item.episodeCount}
          mediaType={item.mediaType}
        />
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {item.title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    // width + marginRight come from props
  },
  rootPressed: {
    opacity: opacity.pressed,
  },
  posterWrap: {
    borderRadius: radius.md,
    overflow: "hidden",
    position: "relative",
  },
  poster: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  posterFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  posterFallbackGlyph: {
    color: colors.textMuted,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
  },
  progressTrack: {
    backgroundColor: colors.surfaceElevated,
    bottom: 0,
    height: 3,
    left: 0,
    position: "absolute",
    right: 0,
  },
  progressFill: {
    backgroundColor: colors.accent,
    height: 3,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    marginTop: spacing.sm,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: 2,
  },
});
