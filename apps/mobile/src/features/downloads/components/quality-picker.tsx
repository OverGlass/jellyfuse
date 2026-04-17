// Body-only quality list rendered inside the `download-quality/[itemId]`
// formSheet route. Pure component — caller owns data + navigation.
//
// "Original" downloads the raw source file (`/Items/{id}/Download`) with all
// audio and subtitle tracks embedded. The other options enqueue a transcoded
// MP4 via `/Videos/{id}/stream.mp4?Static=false&MaxStreamingBitrate=N`.

import { colors, fontSize, fontWeight, opacity, spacing } from "@jellyfuse/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

export interface DownloadQuality {
  label: string;
  /** Bitrate cap in bits per second. Undefined = Original (source file). */
  maxBitrate?: number;
  /** Human-readable subtitle — shown under the label. */
  hint: string;
}

export const DOWNLOAD_QUALITIES: DownloadQuality[] = [
  { label: "Original", hint: "Source file · all tracks" },
  { label: "High", maxBitrate: 20_000_000, hint: "Up to 20 Mbps · 1080p" },
  { label: "Medium", maxBitrate: 8_000_000, hint: "Up to 8 Mbps · 720p" },
  { label: "Low", maxBitrate: 3_000_000, hint: "Up to 3 Mbps · 480p" },
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
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Download quality</Text>
      {DOWNLOAD_QUALITIES.map((quality) => {
        const sizeHint = qualitySizeHint(quality, durationSeconds);
        return (
          <Pressable
            key={quality.label}
            onPress={() => onSelect(quality)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{quality.label}</Text>
              <Text style={styles.rowHint}>
                {sizeHint ? `${quality.hint} · ≈ ${sizeHint}` : quality.hint}
              </Text>
            </View>
          </Pressable>
        );
      })}
      <Text style={styles.footnote}>
        Non-Original qualities transcode on the server at ~1× playback speed.
      </Text>
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
