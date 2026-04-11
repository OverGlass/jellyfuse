import type { MediaItem } from "@jellyfuse/api";
import { colors, duration, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * One row in the series detail episode list. Thumbnail + index + title
 * + optional runtime + progress bar (from `UserData.PlayedPercentage`).
 * Pure component — props in, `onPress` out.
 */
interface Props {
  item: MediaItem;
  onPress: () => void;
}

const THUMB_WIDTH = 140;
const THUMB_HEIGHT = 80; // 16:9-ish

export function EpisodeRow({ item, onPress }: Props) {
  const indexLabel = item.episodeNumber !== undefined ? `${item.episodeNumber}.` : "";
  const runtime = item.runtimeMinutes !== undefined ? `${item.runtimeMinutes}m` : undefined;
  const progress = item.progress ?? 0;
  const hasProgress = progress > 0.01;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Episode ${item.episodeNumber ?? ""} ${item.title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.root, pressed && styles.rootPressed]}
    >
      <View style={styles.thumbWrap}>
        {item.posterUrl ? (
          <Image
            source={item.posterUrl}
            style={styles.thumb}
            contentFit="cover"
            transition={duration.normal}
            recyclingKey={item.posterUrl}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]} />
        )}
        {hasProgress ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.textBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {indexLabel} {item.title}
        </Text>
        {runtime ? <Text style={styles.meta}>{runtime}</Text> : null}
        {item.overview ? (
          <Text style={styles.overview} numberOfLines={3}>
            {item.overview}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rootPressed: {
    opacity: opacity.pressed,
  },
  thumbWrap: {
    borderRadius: radius.md,
    overflow: "hidden",
    position: "relative",
    width: THUMB_WIDTH,
  },
  thumb: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    height: THUMB_HEIGHT,
    width: THUMB_WIDTH,
  },
  thumbFallback: {
    backgroundColor: colors.surface,
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
  textBlock: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  meta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
  overview: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    marginTop: spacing.xs,
  },
});
