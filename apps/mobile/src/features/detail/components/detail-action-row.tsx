import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Detail screen primary action row. Phase 2d ships `Play` (placeholder
 * until Phase 3 lands the MPV player) and `Download` / `Request`
 * buttons wired as callbacks so the parent screen can no-op them
 * without baking UI placeholders into the pure component.
 *
 * `Play` uses the accent CTA style; the secondary actions use the
 * surface background with secondary text for hierarchy.
 */
interface Props {
  hasResume: boolean;
  onPlay: () => void;
  onDownload?: () => void;
  onRequest?: () => void;
}

export function DetailActionRow({ hasResume, onPlay, onDownload, onRequest }: Props) {
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
      {onDownload ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download"
          onPress={onDownload}
          style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        >
          <Text style={styles.secondaryLabel}>Download</Text>
        </Pressable>
      ) : null}
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
