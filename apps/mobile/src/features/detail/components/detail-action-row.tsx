import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Detail screen primary action row. `Play` uses the accent CTA style;
 * secondary actions use the surface background. `downloadSlot` accepts
 * a `DownloadButton` (Phase 5) that shows state-aware iconography and
 * a progress ring — the caller owns the interaction logic.
 */
interface Props {
  hasResume: boolean;
  onPlay: () => void;
  /** Called when the text "Download" label is tapped (legacy path). */
  onDownload?: () => void;
  /** Slot for a `DownloadButton` component with state-aware visuals. */
  downloadSlot?: ReactNode;
  onRequest?: () => void;
}

export function DetailActionRow({ hasResume, onPlay, onDownload, downloadSlot, onRequest }: Props) {
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hasResume ? "Resume" : "Play"}
        onPress={onPlay}
        style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
      >
        <Text style={styles.primaryLabel}>{hasResume ? "Resume" : "Play"}</Text>
      </Pressable>
      {/* Prefer the slot (has state-aware progress ring) over the text button */}
      {downloadSlot ??
        (onDownload ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Download"
            onPress={onDownload}
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          >
            <Text style={styles.secondaryLabel}>Download</Text>
          </Pressable>
        ) : null)}
      {onRequest ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Request"
          onPress={onRequest}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.secondaryLabel}>Request</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  primary: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  primaryPressed: {
    opacity: opacity.pressed,
  },
  primaryLabel: {
    color: colors.accentContrast,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
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
