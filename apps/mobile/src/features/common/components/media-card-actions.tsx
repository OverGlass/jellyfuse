import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

// TODO(played-actions): migrate this formSheet to expo-ui SwiftUI ContextMenu
// on iOS / DropdownMenu on Android once expo-ui ships those primitives stably.
// See: https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/contextmenu/
//      https://docs.expo.dev/versions/latest/sdk/ui/jetpack-compose/dropdownmenu/

/**
 * Per-item action sheet shown after a long-press on a `MediaCard`.
 * Pure component — `played` describes current state, callbacks fire
 * out. The hosting route owns mutation wiring and dismissal.
 *
 * Single-action today (Mark Played / Mark Unplayed) but laid out so we
 * can stack favourite / download / share rows here later without
 * restructuring the route.
 */
interface Props {
  title: string;
  played: boolean;
  onTogglePlayed: () => void;
  onCancel: () => void;
}

export function MediaCardActions({ title, played, onTogglePlayed, onCancel }: Props) {
  const { t } = useTranslation();
  const togglePlayedLabel = played ? t("mediaActions.markUnplayed") : t("mediaActions.markPlayed");
  return (
    <View style={styles.root}>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={togglePlayedLabel}
        onPress={onTogglePlayed}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <Text style={styles.rowLabel}>{togglePlayedLabel}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.cancel")}
        onPress={onCancel}
        style={({ pressed }) => [styles.cancel, pressed && styles.rowPressed]}
      >
        <Text style={styles.cancelLabel}>{t("common.cancel")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.surface,
    gap: spacing.sm,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  title: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  row: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  rowLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  cancel: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    justifyContent: "center",
    marginTop: spacing.xs,
    minHeight: 48,
  },
  cancelLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
});
