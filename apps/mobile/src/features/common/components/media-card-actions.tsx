import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

// TODO(played-actions): migrate this formSheet to expo-ui SwiftUI ContextMenu
// on iOS / DropdownMenu on Android once expo-ui ships those primitives stably.
// See: https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/contextmenu/
//      https://docs.expo.dev/versions/latest/sdk/ui/jetpack-compose/dropdownmenu/

/**
 * Per-item action sheet body. Pure list of `actions` rendered above a
 * Cancel row. The hosting route builds the action set based on the
 * item's `mediaType` and `played` flag — see
 * `app/(app)/media-actions/[itemId].tsx`. While the route is still
 * resolving (e.g. waiting on `useSeriesNextUpEpisode`) it can pass
 * `loading: true` to render a placeholder spinner above Cancel.
 */
export interface MediaCardAction {
  /** Stable react key + a11y identifier. */
  key: string;
  label: string;
  onPress: () => void;
}

interface Props {
  title: string;
  actions: MediaCardAction[];
  onCancel: () => void;
  loading?: boolean;
}

export function MediaCardActions({ title, actions, onCancel, loading = false }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.root}>
      {title ? (
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      ) : null}
      {loading ? (
        <View style={[styles.row, styles.loadingRow]}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      ) : null}
      {actions.map((action) => (
        <Pressable
          key={action.key}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <Text style={styles.rowLabel}>{action.label}</Text>
        </Pressable>
      ))}
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
    justifyContent: "center",
    minHeight: 48,
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
  loadingRow: {
    alignItems: "center",
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
