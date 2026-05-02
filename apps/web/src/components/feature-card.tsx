import { StyleSheet, Text, View } from "react-native";
import { colors, fontWeight, radius, spacing } from "@jellyfuse/theme";

import { FeatureIcon } from "./feature-icon";
import type { FeatureIconId } from "../lib/content";

type Props = {
  title: string;
  body: string;
  icon: FeatureIconId;
};

// Flat card surface in the 3×3 features grid. Per the design's
// post-feedback iteration, no hover lift, no transitions — these are not
// interactive and pretending otherwise is an anti-pattern.
export function FeatureCard({ title, body, icon }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <FeatureIcon id={icon} size={20} color={colors.accent} />
      </View>
      <Text accessibilityRole="header" aria-level={4} style={styles.title}>
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(215,218,224,0.08)",
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(97,175,239,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
    fontSize: 17,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.01 * 17,
    color: colors.textPrimary,
    marginBottom: 6,
  },
  body: {
    fontSize: 14,
    lineHeight: 14 * 1.5,
    color: colors.textSecondary,
  },
});
