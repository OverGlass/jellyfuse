import { colors, fontSize, fontWeight, radius, spacing } from "@jellyfuse/theme";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * A named group of settings rows. The iOS-style grouped-list look: a
 * small uppercase caption above a rounded card that wraps its children.
 * The card uses `colors.surface` against the `colors.background` page
 * so rows read as a floating group rather than edge-to-edge table cells.
 *
 * Consumers compose rows directly; this component owns only the title
 * + container chrome (rounded corners, divider shared between rows is
 * the row's responsibility — each row draws a hairline top border
 * except the first, which the row component decides via its `isFirst`).
 */
interface Props {
  title?: string;
  children: ReactNode;
  /** Optional hint rendered under the group — for disclaimers / context. */
  footer?: string;
}

export function SettingsSection({ title, children, footer }: Props) {
  return (
    <View style={styles.root}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xs,
  },
  title: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    marginLeft: spacing.md,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  footer: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    lineHeight: 18,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
});
