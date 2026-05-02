import { StyleSheet, Text } from "react-native";
import { colors, fontWeight, spacing } from "@jellyfuse/theme";

type Props = { tone?: "accent" | "muted"; children: React.ReactNode };

// Small uppercase tagline that sits above each section headline. Always
// 12px, 600 weight, tracked, accent or muted depending on context.
export function Eyebrow({ tone = "accent", children }: Props) {
  return (
    <Text
      accessibilityRole="text"
      style={[styles.eyebrow, tone === "accent" ? styles.accent : styles.muted]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.14 * 12,
    textTransform: "uppercase",
    marginBottom: spacing.md,
  },
  accent: {
    color: colors.accent,
  },
  muted: {
    color: colors.textMuted,
  },
});
