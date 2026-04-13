import type { MediaItem } from "@jellyfuse/api";
import { mediaItemSubtitle } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * One row in the blended search list. Pure component — takes a
 * `MediaItem` plus an `onPress` callback. Origin of the result
 * (Jellyfin / Jellyseerr / both) is rendered as a small badge so
 * the user knows whether tapping plays from library or opens the
 * request flow.
 *
 * Layout: 56×84 poster on the left, title + subtitle + 2-line
 * overview in the middle, source badge stacked under the subtitle.
 * Whole row is one Pressable.
 */
interface Props {
  item: MediaItem;
  onPress: () => void;
}

const POSTER_WIDTH = 56;
const POSTER_HEIGHT = 84;

export function SearchResultRow({ item, onPress }: Props) {
  const subtitle = mediaItemSubtitle(item);
  const overview = item.overview?.trim();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      onPress={onPress}
      style={({ pressed }) => [styles.root, pressed && styles.rootPressed]}
    >
      <View style={styles.posterWrap}>
        {item.posterUrl ? (
          <Image
            source={item.posterUrl}
            style={styles.poster}
            contentFit="cover"
            recyclingKey={item.posterUrl}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.poster, styles.posterFallback]}>
            <Text style={styles.posterFallbackLetter}>{item.title.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {overview ? (
          <Text style={styles.overview} numberOfLines={2}>
            {overview}
          </Text>
        ) : null}
      </View>
      <SourceBadge source={item.source} />
    </Pressable>
  );
}

interface BadgeProps {
  source: MediaItem["source"];
}

function SourceBadge({ source }: BadgeProps) {
  const label = source === "jellyfin" ? "Library" : source === "both" ? "Library" : "Request";
  const isRequest = source === "jellyseerr";
  return (
    <View style={[styles.badge, isRequest ? styles.badgeRequest : styles.badgeLibrary]}>
      <Text style={[styles.badgeLabel, isRequest && styles.badgeLabelRequest]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rootPressed: {
    opacity: opacity.pressed,
  },
  posterWrap: {
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  poster: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    height: POSTER_HEIGHT,
    width: POSTER_WIDTH,
  },
  posterFallback: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    justifyContent: "center",
  },
  posterFallbackLetter: {
    color: colors.textSecondary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.bold,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  overview: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.xs,
  },
  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeLibrary: {
    backgroundColor: colors.accent,
  },
  badgeRequest: {
    backgroundColor: colors.surfaceElevated,
  },
  badgeLabel: {
    color: colors.accentContrast,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
  },
  badgeLabelRequest: {
    color: colors.textSecondary,
  },
});
