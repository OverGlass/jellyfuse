import { NerdIcon } from "@/features/common/components/nerd-icon";
import { colors, fontSize, fontWeight, opacity, spacing } from "@jellyfuse/theme";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/**
 * One row inside a `SettingsSection` card. Renders:
 *
 *   [ label / sublabel ]  [ trailing: value | custom | chevron ]
 *
 * The row is pressable when `onPress` is provided — tap feedback uses
 * the standard `opacity.pressed`. When non-pressable (e.g. a read-only
 * "server version" row) the label still reads as a regular row but
 * without the ripple.
 *
 * Pure component: props in, `onPress` out. All state lives in the
 * parent (picker visibility, toggle state, etc.).
 */
interface Props {
  label: string;
  sublabel?: string;
  /** Right-side text (e.g. currently-selected picker value). */
  value?: string;
  /**
   * Right-side custom slot — takes precedence over `value`. Used for
   * toggle rows (native `Switch`) and link rows (custom chevron).
   */
  trailing?: ReactNode;
  /** Tap handler. When omitted the row renders non-interactive. */
  onPress?: () => void;
  /**
   * Show a trailing chevron — implies a picker/drill-in. Ignored when
   * `trailing` is provided. Default: true when `onPress` is set.
   */
  showChevron?: boolean;
  /**
   * Destructive styling for dangerous actions (sign out, delete). Tints
   * the label red and is incompatible with `value`/`trailing`.
   */
  destructive?: boolean;
  /**
   * When true, draws a hairline divider on the top edge. The first row
   * in a section passes `false`; every subsequent row passes `true`.
   */
  hasDivider?: boolean;
}

export function SettingsRow({
  label,
  sublabel,
  value,
  trailing,
  onPress,
  showChevron,
  destructive = false,
  hasDivider = true,
}: Props) {
  const interactive = onPress !== undefined;
  const chevron = showChevron ?? (interactive && !trailing);
  const body = (
    <View style={[styles.row, hasDivider && styles.divider]}>
      <View style={styles.labelCol}>
        <Text style={[styles.label, destructive && styles.labelDestructive]} numberOfLines={1}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={styles.sublabel} numberOfLines={2}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <View style={styles.trailing}>{trailing}</View>
      ) : value !== undefined ? (
        <View style={styles.trailing}>
          <Text style={styles.value} numberOfLines={1}>
            {value}
          </Text>
          {chevron ? <NerdIcon name="chevronRight" size={14} color={colors.textMuted} /> : null}
        </View>
      ) : chevron ? (
        <View style={styles.trailing}>
          <NerdIcon name="chevronRight" size={14} color={colors.textMuted} />
        </View>
      ) : null}
    </View>
  );

  if (!interactive) {
    return body;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  divider: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  labelCol: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  labelDestructive: {
    color: colors.danger,
  },
  sublabel: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    lineHeight: 18,
  },
  trailing: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  value: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    maxWidth: 180,
  },
});
