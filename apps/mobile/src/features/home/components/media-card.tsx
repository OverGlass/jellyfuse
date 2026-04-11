import type { MediaItem } from "@jellyfuse/api";
import { episodeLabel } from "@jellyfuse/models";
import { colors, duration, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Poster + title + subtitle card used in every home shelf. Pure component:
 * props in, `onPress` callback out, no reach into parent state.
 *
 * **Responsive**: `width` + `posterHeight` are passed in from the parent
 * shelf (which reads them from `useBreakpoint()`). The card is otherwise
 * size-agnostic, which lets phone / tablet / desktop share the same
 * component with different footprints.
 *
 * Subtitle is the Jellyfin episode label (`"S2 · E4"`) for episodes,
 * otherwise the release year. Falls back to a surface-colored placeholder
 * when `item.posterUrl` is missing (deleted artwork, fresh libraries).
 */

interface Props {
  item: MediaItem;
  /** Card width + poster height come from `useBreakpoint().values`. */
  width: number;
  posterHeight: number;
  /** Horizontal gap between this card and the next one in the shelf row. */
  gap: number;
  onPress: () => void;
}

export function MediaCard({ item, width, posterHeight, gap, onPress }: Props) {
  const subtitle = episodeLabel(item) ?? (item.year !== undefined ? String(item.year) : "");
  const accessibilityLabel = subtitle ? `${item.title}, ${subtitle}` : item.title;

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
