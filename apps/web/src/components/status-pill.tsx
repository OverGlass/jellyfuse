import { StyleSheet, Text, View } from "react-native";
import { colors, fontWeight, radius } from "@jellyfuse/theme";

import type { PlatformStatus } from "../lib/content";

const PALETTE: Record<
  PlatformStatus,
  { fg: string; border: string; led: string; ledShadow?: string }
> = {
  shipping: {
    fg: colors.success,
    border: "rgba(152,195,121,0.28)",
    led: colors.success,
    ledShadow: "0 0 8px rgba(152,195,121,0.7)",
  },
  soon: {
    fg: colors.warning,
    border: "rgba(209,154,102,0.28)",
    led: colors.warning,
  },
  indev: {
    fg: colors.accent,
    border: "rgba(97,175,239,0.28)",
    led: colors.accent,
  },
  roadmap: {
    fg: colors.textMuted,
    border: "rgba(127,132,142,0.28)",
    led: colors.textMuted,
  },
};

type Props = { status: PlatformStatus; label: string };

// Pill badge used at the top of every platform-step. The LED dot uses
// a subtle CSS box-shadow on the "Shipping" variant only (the prototype
// hints at a real device only when something is in customers' hands).
export function StatusPill({ status, label }: Props) {
  const tint = PALETTE[status];
  return (
    <View style={[styles.pill, { borderColor: tint.border }]}>
      <View
        style={[
          styles.led,
          { backgroundColor: tint.led },
          tint.ledShadow ? ({ boxShadow: tint.ledShadow } as never) : null,
        ]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text style={[styles.label, { color: tint.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 5,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: radius.full,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  led: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
  },
  label: {
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.02 * 12,
  },
});
