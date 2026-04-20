// Body-only quality list rendered inside the `download-quality/[itemId]`
// formSheet route. Pure component — caller owns data + navigation.
//
// "Original" downloads the raw source file (`/Items/{id}/Download`) with all
// audio and subtitle tracks embedded. The other options enqueue a transcoded
// MP4 via `/Videos/{id}/stream.mp4?Static=false&MaxStreamingBitrate=N`.

import { colors, fontSize, fontWeight, opacity, spacing } from "@jellyfuse/theme";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

export interface DownloadQuality {
  /** Stable identifier passed back to the caller — not user-visible. */
  key: "original" | "high" | "medium" | "low";
  /** Bitrate cap in bits per second. Undefined = Original (source file). */
  maxBitrate?: number;
}

export const DOWNLOAD_QUALITIES: DownloadQuality[] = [
  { key: "original" },
  { key: "high", maxBitrate: 20_000_000 },
  { key: "medium", maxBitrate: 8_000_000 },
  { key: "low", maxBitrate: 3_000_000 },
];

interface Props {
  onSelect: (quality: DownloadQuality) => void;
  /**
   * Item runtime in seconds — used to show a size estimate under each
   * transcoded option (`bitrate × duration / 8`). Pass 0 if unknown.
   */
  durationSeconds: number;
}

export function QualityPicker({ onSelect, durationSeconds }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("downloads.quality.title")}</Text>
      {DOWNLOAD_QUALITIES.map((quality) => {
        const sizeHint = qualitySizeHint(quality, durationSeconds);
        const label = t(`downloads.quality.${quality.key}` as "downloads.quality.original");
        const hint = t(`downloads.quality.${quality.key}Hint` as "downloads.quality.originalHint");
        return (
          <Pressable
            key={quality.key}
            onPress={() => onSelect(quality)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{label}</Text>
              <Text style={styles.rowHint}>{sizeHint ? `${hint} · ≈ ${sizeHint}` : hint}</Text>
            </View>
          </Pressable>
        );
      })}
      <Text style={styles.footnote}>{t("downloads.quality.footnote")}</Text>
    </View>
  );
}

function qualitySizeHint(quality: DownloadQuality, durationSeconds: number): string | undefined {
  if (!quality.maxBitrate || durationSeconds <= 0) return undefined;
  const bytes = (quality.maxBitrate * durationSeconds) / 8;
  return formatBytes(bytes);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${Math.round(bytes / 1_048_576)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  title: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  rowText: {
    gap: 2,
  },
  rowLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  rowHint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
  footnote: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginTop: spacing.md,
  },
});
