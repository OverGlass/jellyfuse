import type { DownloadProgress, MediaRequest } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * One row in the Jellyseerr requests list. Pure component — takes a
 * `MediaRequest` plus an optional `DownloadProgress` looked up by
 * the screen from the map returned by `useDownloadProgressMap`.
 *
 * Layout mirrors `SearchResultRow` for a consistent look across the
 * app: poster on the left, stacked title + submeta in the middle,
 * status badge on the right. Approved + pending rows also show a
 * thin progress bar under the submeta when a download is in
 * progress — the indeterminate "queued, no bytes yet" sentinel
 * (`fraction === -1`) renders as a fully-gradient bar.
 */
interface Props {
  request: MediaRequest;
  progress: DownloadProgress | undefined;
  onPress: () => void;
}

const POSTER_WIDTH = 56;
const POSTER_HEIGHT = 84;

export function RequestRow({ request, progress, onPress }: Props) {
  const { t } = useTranslation();
  const subtitle = buildSubtitle(request, t);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={request.title}
      onPress={onPress}
      style={({ pressed }) => [styles.root, pressed && styles.rootPressed]}
    >
      <View style={styles.posterWrap}>
        {request.posterUrl ? (
          <Image
            source={request.posterUrl}
            style={styles.poster}
            contentFit="cover"
            recyclingKey={request.posterUrl}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.poster, styles.posterFallback]}>
            <Text style={styles.posterFallbackLetter}>
              {request.title.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {request.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
        {progress ? <ProgressBar progress={progress} /> : null}
      </View>
      <StatusBadge status={request.status} />
    </Pressable>
  );
}

function buildSubtitle(request: MediaRequest, t: TFunction): string {
  const parts: string[] = [];
  parts.push(request.mediaType === "tv" ? t("requests.row.series") : t("requests.row.movie"));
  if (request.mediaType === "tv" && request.seasons.length > 0) {
    parts.push(
      request.seasons.length === 1
        ? t("requests.row.seasonPrefix", { season: request.seasons[0] })
        : t("requests.row.seasonsCount", { count: request.seasons.length }),
    );
  }
  parts.push(t("requests.row.byUser", { user: request.requestedBy }));
  return parts.join(" · ");
}

// ──────────────────────────────────────────────────────────────────────
// Status badge
// ──────────────────────────────────────────────────────────────────────

interface BadgeProps {
  status: MediaRequest["status"];
}

function StatusBadge({ status }: BadgeProps) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: config.background }]}>
      <Text style={[styles.badgeLabel, { color: config.foreground }]}>{t(config.labelKey)}</Text>
    </View>
  );
}

const STATUS_CONFIG: Record<
  MediaRequest["status"],
  {
    labelKey:
      | "requests.status.pending"
      | "requests.status.approved"
      | "requests.status.available"
      | "requests.status.declined";
    background: string;
    foreground: string;
  }
> = {
  pending: {
    labelKey: "requests.status.pending",
    background: colors.surfaceElevated,
    foreground: colors.warning,
  },
  approved: {
    labelKey: "requests.status.approved",
    background: colors.surfaceElevated,
    foreground: colors.accent,
  },
  available: {
    labelKey: "requests.status.available",
    background: colors.success,
    foreground: colors.background,
  },
  declined: {
    labelKey: "requests.status.declined",
    background: colors.surfaceElevated,
    foreground: colors.danger,
  },
};

// ──────────────────────────────────────────────────────────────────────
// Progress bar
// ──────────────────────────────────────────────────────────────────────

interface ProgressBarProps {
  progress: DownloadProgress;
}

function ProgressBar({ progress }: ProgressBarProps) {
  const { t } = useTranslation();
  const indeterminate = progress.fraction < 0;
  const pct = indeterminate ? 100 : Math.round(progress.fraction * 100);
  const fillWidth: `${number}%` = indeterminate ? "100%" : `${pct}%`;
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: fillWidth },
            indeterminate && styles.progressFillIndeterminate,
          ]}
        />
      </View>
      <Text style={styles.progressLabel}>
        {indeterminate
          ? t("requests.row.progress.queued")
          : progress.timeLeft
            ? `${pct}% · ${progress.timeLeft}`
            : `${pct}%`}
      </Text>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────

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
  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
  },
  progressRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  progressTrack: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    flex: 1,
    height: 4,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: colors.accent,
    height: 4,
  },
  progressFillIndeterminate: {
    // Solid accent bar — an animated shimmer would be nicer but
    // reanimated needs a worklet to loop and we want this row pure.
    // A future ARK-XX can port the shimmer from the detail hero.
    opacity: 0.35,
  },
  progressLabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    minWidth: 72,
    textAlign: "right",
  },
});
