import { StyleSheet, Text } from "react-native";
import { colors, fontWeight, radius } from "@jellyfuse/theme";

type Props = { label: string; strong?: boolean };

export function CodecChip({ label, strong = false }: Props) {
  return (
    <Text accessibilityRole="text" style={[styles.chip, strong ? styles.strong : styles.weak]}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    fontSize: 13,
    fontWeight: fontWeight.medium,
    backgroundColor: colors.background,
    // tabular numerals for codec bits — keeps "H.264" the right width.
    fontVariant: ["tabular-nums"],
  },
  strong: {
    color: colors.textPrimary,
    borderColor: "rgba(215,218,224,0.18)",
  },
  weak: {
    color: colors.textSecondary,
    borderColor: "rgba(215,218,224,0.08)",
  },
});
