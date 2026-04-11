import { colors, duration, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Poster + title + year card used in every home shelf. Pure component:
 * props in, `onPress` callback out, no reach into parent state.
 * Replaces the Rust `MediaCard` component in `jf-ui-kit/src/components/`.
 */

export const MEDIA_CARD_WIDTH = 120;
export const MEDIA_CARD_POSTER_HEIGHT = 180;
export const MEDIA_CARD_TOTAL_HEIGHT = MEDIA_CARD_POSTER_HEIGHT + 48;

interface Props {
  title: string;
  year: number;
  posterUrl: string;
  onPress: () => void;
}

export function MediaCard({ title, year, posterUrl, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${year}`}
      onPress={onPress}
      style={({ pressed }) => [styles.root, pressed && styles.rootPressed]}
    >
      <Image
        source={posterUrl}
        style={styles.poster}
        contentFit="cover"
        transition={duration.normal}
        recyclingKey={posterUrl}
        cachePolicy="memory-disk"
      />
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.year}>{year}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: MEDIA_CARD_WIDTH,
    marginRight: spacing.md,
  },
  rootPressed: {
    opacity: opacity.pressed,
  },
  poster: {
    width: MEDIA_CARD_WIDTH,
    height: MEDIA_CARD_POSTER_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    marginTop: spacing.sm,
  },
  year: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: 2,
  },
});
