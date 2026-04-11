import type { MediaItem } from "@jellyfuse/api";
import { episodeLabel } from "@jellyfuse/models";
import { colors, duration, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Landscape 16:9 card used by the Continue Watching shelf (and any
 * other "recently viewed" shelf that wants to show episode / backdrop
 * thumbs instead of posters). Mirrors `jf-ui-kit::WideMediaCard`.
 *
 * Layout per jf-ui-kit:
 * - 16:9 thumbnail
 * - Title (series name for episodes, movie name otherwise)
 * - Subtitle: `"S2 · E4 – Episode Title"` for episodes, year for movies
 * - Viewing progress bar overlaid at the bottom when `progress > 0`
 *
 * Pure component: data in, `onPress` out. Responsive sizing comes from
 * the parent shelf via `width` + `height` props (driven by
 * `useBreakpoint()`).
 */

interface Props {
  item: MediaItem;
  width: number;
  height: number;
  /** Horizontal gap between this card and the next card in the shelf row. */
  gap: number;
  onPress: () => void;
}

export function WideMediaCard({ item, width, height, gap, onPress }: Props) {
  // Episodes show the episode thumbnail (poster in Jellyfin parlance);
  // movies use the backdrop and fall back to the poster.
  const thumbUrl =
    item.mediaType === "episode"
      ? (item.posterUrl ?? item.backdropUrl)
      : (item.backdropUrl ?? item.posterUrl);

  const title = item.seriesName ?? item.title;
  const epLabel = episodeLabel(item);
  const subtitle = epLabel
    ? `${epLabel} – ${item.title}`
    : item.year !== undefined
      ? String(item.year)
      : undefined;

  const accessibilityLabel = subtitle ? `${title}, ${subtitle}` : title;
  const progress = item.progress ?? 0;
  const hasProgress = progress > 0.01;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.root,
        { width, marginRight: gap },
        pressed && styles.rootPressed,
      ]}
    >
      <View style={[styles.thumbWrap, { width, height }]}>
        {thumbUrl ? (
          <Image
            source={thumbUrl}
            style={[styles.thumb, { width, height }]}
            contentFit="cover"
            transition={duration.normal}
            recyclingKey={thumbUrl}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.thumbFallback, { width, height }]}>
            <Text style={styles.thumbFallbackGlyph}>{title.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        {hasProgress ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
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
  thumbWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: "hidden",
    position: "relative",
  },
  thumb: {
    borderRadius: radius.md,
  },
  thumbFallback: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    justifyContent: "center",
  },
  thumbFallbackGlyph: {
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
