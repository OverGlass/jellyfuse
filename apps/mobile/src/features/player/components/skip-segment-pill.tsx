// "Skip intro →" / "Skip recap →" / "Skip credits →" pill.
// Appears when current position is inside a segment from the
// intro-skipper Jellyfin plugin. Tap → seek to segment end.
// Pure component — position + segments in, seek callback out.

import type { IntroSkipperSegments, SkipSegment } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, radius, spacing } from "@jellyfuse/theme";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  position: number;
  segments: IntroSkipperSegments | undefined;
  onSkip: (toSeconds: number) => void;
}

interface ActiveSegment {
  label: string;
  end: number;
}

function findActiveSegment(
  position: number,
  segments: IntroSkipperSegments | undefined,
): ActiveSegment | null {
  if (!segments) return null;

  const checks: [string, SkipSegment | undefined][] = [
    ["Skip Intro", segments.introduction],
    ["Skip Recap", segments.recap],
    ["Skip Credits", segments.credits],
  ];

  for (const [label, seg] of checks) {
    if (seg && position >= seg.start && position < seg.end) {
      return { label, end: seg.end };
    }
  }
  return null;
}

export function SkipSegmentPill({ position, segments, onSkip }: Props) {
  const insets = useSafeAreaInsets();
  const active = findActiveSegment(position, segments);

  const visible = active !== null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          bottom: Math.max(insets.bottom, spacing.lg) + 60, // above scrubber
          right: Math.max(insets.right, spacing.lg),
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? "auto" : "none",
          transitionProperty: "opacity",
          transitionDuration: 200,
        },
      ]}
    >
      {active ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={active.label}
          onPress={() => onSkip(active.end)}
          style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
        >
          <Text style={styles.label}>{active.label} →</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
  },
  pill: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pillPressed: {
    opacity: 0.8,
  },
  label: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
});
