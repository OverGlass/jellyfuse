import type { MediaItem } from "@jellyfuse/api";
import { colors, duration, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { UnplayedCornerBadge } from "@/features/common/components/unplayed-corner-badge";

/**
 * One row in the series detail episode list. Thumbnail + index + title
 * + optional runtime + progress bar (from `UserData.PlayedPercentage`).
 * Pure component — props in, callbacks out.
 *
 * `rightSlot` is an optional render slot used for per-episode actions
 * (e.g. the offline `DownloadButton`). The parent owns the state and
 * callbacks; the row just reserves layout room on the right edge.
 *
 * Long-press fires `onLongPress`, which the parent screen wires to the
 * shared `media-actions/[itemId]` formSheet — same affordance the home
 * shelves use, so there's a single "per-item actions" entry point
 * across the app rather than a separate swipe gesture for episodes.
 *
 * The `<UnplayedCornerBadge />` overlays the thumbnail's top-right when
 * `userData.played === false` (and the episode hasn't been started) so
 * an unwatched episode is identifiable at a glance.
 */
interface Props {
  item: MediaItem;
  onPress: () => void;
  rightSlot?: ReactNode;
  /** When true, the row is dimmed and press is a no-op. Used for
   *  offline-unavailable episodes (no local copy). */
  disabled?: boolean;
  /** Long-press opens the per-item action sheet (Mark Played, …). */
  onLongPress?: () => void;
}

const THUMB_WIDTH = 140;
const THUMB_HEIGHT = 80; // 16:9-ish

export function EpisodeRow({ item, onPress, rightSlot, disabled = false, onLongPress }: Props) {
  const { t } = useTranslation();
  const indexLabel = item.episodeNumber !== undefined ? `${item.episodeNumber}.` : "";
  const runtime = item.runtimeMinutes !== undefined ? `${item.runtimeMinutes}m` : undefined;
  const progress = item.progress ?? 0;
  const hasProgress = progress > 0.01;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("detail.episode.ariaLabel", {
        number: item.episodeNumber ?? "",
        title: item.title,
      })}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.root,
        pressed && styles.rootPressed,
        disabled && styles.rootDisabled,
      ]}
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
        <UnplayedCornerBadge
          played={item.userData?.played}
          progress={item.progress}
          playCount={item.userData?.playCount}
          lastPlayedDate={item.userData?.lastPlayedDate}
          mediaType={item.mediaType}
          size={14}
        />
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
      {rightSlot ? <View style={styles.rightSlot}>{rightSlot}</View> : null}
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
  rootDisabled: {
    opacity: opacity.disabled,
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
  rightSlot: {
    alignItems: "center",
    alignSelf: "center",
    justifyContent: "center",
  },
});
