/**
 * `DownloadRow` — one row in the downloads list. Shows the poster,
 * title, progress, and contextual action buttons based on the download
 * state.
 *
 * Pure component: all actions are callbacks so the screen owns the
 * side-effect logic.
 *
 * State → actions:
 *   queued     → cancel
 *   downloading → pause + cancel
 *   paused     → resume + cancel
 *   done       → play + delete
 *   failed     → retry + delete
 */
import {
  colors,
  fontSize,
  fontWeight,
  opacity,
  radius,
  spacing,
  type IconName,
} from "@jellyfuse/theme";
import type { DownloadRecord } from "@jellyfuse/models";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { NerdIcon } from "@/features/common/components/nerd-icon";

const POSTER_WIDTH = 56;
const POSTER_HEIGHT = 84;
const ICON_SIZE = 20;

export interface DownloadRowCallbacks {
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onPlay: (record: DownloadRecord) => void;
}

interface Props extends DownloadRowCallbacks {
  record: DownloadRecord;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function episodeLabel(r: DownloadRecord): string | undefined {
  if (r.seasonNumber !== undefined && r.episodeNumber !== undefined) {
    return `S${r.seasonNumber} · E${r.episodeNumber}`;
  }
  return undefined;
}

function ProgressBar({ fraction }: { fraction: number }) {
  return (
    <View style={progressStyles.track}>
      <View style={[progressStyles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    backgroundColor: `${colors.textPrimary}20`,
    borderRadius: radius.sm,
    height: 3,
    overflow: "hidden",
  },
  fill: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    height: "100%",
  },
});

export function DownloadRow({
  record,
  onPause,
  onResume,
  onCancel,
  onDelete,
  onRetry,
  onPlay,
}: Props) {
  const { id, state, bytesDownloaded, bytesTotal, metadata } = record;
  const fraction = bytesTotal > 0 ? bytesDownloaded / bytesTotal : 0;
  const ep = episodeLabel(record);
  const showProgress = state === "downloading" || state === "paused";

  return (
    <View style={styles.root}>
      {/* Poster */}
      <View style={styles.poster}>
        {record.imageUrl ? (
          <Image
            source={record.imageUrl}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={record.imageUrl}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.posterFallback]} />
        )}
      </View>

      {/* Info */}
      <View style={styles.info}>
        {record.seriesTitle ? (
          <Text style={styles.series} numberOfLines={1}>
            {record.seriesTitle}
          </Text>
        ) : null}
        <Text style={styles.title} numberOfLines={2}>
          {ep ? `${ep} — ` : ""}
          {record.title}
        </Text>

        {/* Progress bar + bytes */}
        {showProgress ? (
          <View style={styles.progressRow}>
            <ProgressBar fraction={fraction} />
            <Text style={styles.bytes}>
              {formatBytes(bytesDownloaded)} / {formatBytes(bytesTotal)}
            </Text>
          </View>
        ) : state === "done" ? (
          <Text style={styles.doneLabel}>
            {formatBytes(bytesTotal)} · {Math.round(metadata.durationSeconds / 60)}m
          </Text>
        ) : state === "failed" ? (
          <Text style={styles.failedLabel}>Download failed</Text>
        ) : null}

        {/* Action buttons */}
        <View style={styles.actions}>
          {state === "downloading" ? (
            <ActionButton icon="pause" label="Pause" onPress={() => onPause(id)} />
          ) : null}
          {state === "paused" ? (
            <ActionButton icon="play" label="Resume" onPress={() => onResume(id)} />
          ) : null}
          {state === "done" ? (
            <ActionButton icon="play" label="Play" onPress={() => onPlay(record)} accent />
          ) : null}
          {state === "failed" ? (
            <ActionButton icon="refresh" label="Retry" onPress={() => onRetry(id)} />
          ) : null}
          {state === "queued" || state === "downloading" || state === "paused" ? (
            <ActionButton icon="close" label="Cancel" onPress={() => onCancel(id)} />
          ) : null}
          {state === "done" || state === "failed" ? (
            <ActionButton icon="trash" label="Delete" onPress={() => onDelete(id)} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  accent = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
    >
      <NerdIcon name={icon} size={ICON_SIZE} color={accent ? colors.accent : colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  poster: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.sm,
    height: POSTER_HEIGHT,
    overflow: "hidden",
    width: POSTER_WIDTH,
  },
  posterFallback: {
    backgroundColor: colors.surfaceElevated,
  },
  info: {
    flex: 1,
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  series: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  progressRow: {
    gap: spacing.xs,
  },
  bytes: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
  doneLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
  failedLabel: {
    color: colors.danger,
    fontSize: fontSize.caption,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  actionBtn: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  actionBtnPressed: {
    opacity: opacity.pressed,
  },
});
