import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ProgressButton } from "@/features/common/components/progress-button";

/**
 * Detail screen primary action row. The primary Play / Resume button is
 * a `ProgressButton` so a partially-watched item shows how far through
 * it you are, matching the Rust reference `play_button`. Secondary
 * actions use the surface background; `downloadSlot` accepts a
 * `DownloadButton` with state-aware iconography + progress ring.
 */
interface Props {
  hasResume: boolean;
  /** 0–1. Drives the resume fill on the Play button. Defaults to 0. */
  resumeProgress?: number;
  onPlay: () => void;
  /** Called when the text "Download" label is tapped (legacy path). */
  onDownload?: () => void;
  /** Slot for a `DownloadButton` component with state-aware visuals. */
  downloadSlot?: ReactNode;
  onRequest?: () => void;
  /**
   * When false (offline + no local copy), the play button is dimmed,
   * disabled, and its label switches to "Offline" so users understand
   * why it can't be tapped. Default true.
   */
  canPlay?: boolean;
  /** Current played state — drives the played-toggle button label. */
  played?: boolean;
  /** When provided, the row renders a "Mark Played / Unplayed" button. */
  onTogglePlayed?: () => void;
}

export function DetailActionRow({
  hasResume,
  resumeProgress = 0,
  onPlay,
  onDownload,
  downloadSlot,
  onRequest,
  canPlay = true,
  played = false,
  onTogglePlayed,
}: Props) {
  const { t } = useTranslation();
  const primaryLabel = !canPlay
    ? t("detail.action.offline")
    : hasResume
      ? t("detail.resume")
      : t("detail.play");
  const downloadLabel = t("detail.action.download");
  const requestLabel = t("detail.action.request");
  const playedLabel = played ? t("mediaActions.markUnplayed") : t("mediaActions.markPlayed");
  return (
    <View style={styles.root}>
      <View style={styles.primarySlot}>
        <ProgressButton
          label={primaryLabel}
          progress={canPlay && hasResume ? resumeProgress : 0}
          onPress={onPlay}
          disabled={!canPlay}
        />
      </View>
      {/* Prefer the slot (has state-aware progress ring) over the text button */}
      {downloadSlot ??
        (onDownload ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={downloadLabel}
            onPress={onDownload}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          >
            <Text style={styles.secondaryLabel}>{downloadLabel}</Text>
          </Pressable>
        ) : null)}
      {onRequest ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={requestLabel}
          onPress={onRequest}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.secondaryLabel}>{requestLabel}</Text>
        </Pressable>
      ) : null}
      {onTogglePlayed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playedLabel}
          onPress={onTogglePlayed}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.secondaryLabel}>{playedLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  primarySlot: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 160,
  },
  secondary: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  secondaryPressed: {
    opacity: opacity.pressed,
  },
  secondaryLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
});
