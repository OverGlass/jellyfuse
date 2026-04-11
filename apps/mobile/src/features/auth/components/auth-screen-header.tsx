import { colors, fontSize, fontWeight, layout, spacing } from "@jellyfuse/theme";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Shared heading for every `(auth)` screen (server, sign-in, profile
 * picker, add-user). Pins the title to the top of the safe area with
 * the standard `layout.screenPaddingTop` offset so the screens line up
 * visually when the user moves between them.
 *
 * `subtitle` is the plain descriptive text under the title; `extras`
 * accepts arbitrary nodes (e.g. a "Change server" Pressable) rendered
 * in the same column. `rightAction` is rendered on the same row as the
 * title (useful for a modal close button) and is vertically centered
 * against the title line so icons align with the display text.
 */
interface Props {
  title: string;
  subtitle?: string;
  extras?: ReactNode;
  rightAction?: ReactNode;
}

export function AuthScreenHeader({ title, subtitle, extras, rightAction }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {rightAction ? <View style={styles.rightAction}>{rightAction}</View> : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {extras}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xs,
    paddingTop: layout.screenPaddingTop,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
  },
  rightAction: {
    marginLeft: spacing.md,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.bodyLarge,
  },
});
