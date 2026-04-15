// Brief animated pill that appears at the left or right edge of
// the screen when the user double-taps to seek ±10s. Uses Reanimated
// 4 CSS transitions on opacity — fades in, sits for ~600ms, fades out.
// Pure derivation: a monotonically-increasing `triggerId` bumped by
// the parent on each double-tap schedules the re-appearance without
// storing boolean state in an effect.

import { colors, fontFamily, icons, opacity, radius, spacing, withAlpha } from "@jellyfuse/theme";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import Animated from "react-native-reanimated";

const VISIBLE_MS = 500;
const FADE_MS = 200;

interface Props {
  /** Which side of the screen to show. */
  side: "left" | "right";
  /** Monotonic counter — bump to trigger a fresh show. */
  triggerId: number;
  /** Skip amount in seconds (for the label). */
  seconds: number;
  /** Position from the top/bottom safe edge. */
  insetHorizontal: number;
}

export function SeekIndicator({ side, triggerId, seconds, insetHorizontal }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (triggerId === 0) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => clearTimeout(id);
  }, [triggerId]);

  const label =
    side === "left" ? `${icons.fastBackward}  ${seconds}` : `${seconds}  ${icons.fastForward}`;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        side === "left" ? { left: insetHorizontal } : { right: insetHorizontal },
        {
          opacity: visible ? 1 : 0,
          transitionProperty: "opacity",
          transitionDuration: FADE_MS,
        },
      ]}
    >
      <Text style={styles.label}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: "50%",
    marginTop: -24,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: withAlpha(colors.black, opacity.alpha50),
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    fontFamily: fontFamily.icon,
  },
});
