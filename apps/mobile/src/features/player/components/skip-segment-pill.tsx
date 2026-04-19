// "Skip intro →" / "Skip recap →" / "Skip credits →" pill.
// Appears when current position is inside a segment from the
// intro-skipper Jellyfin plugin. Tap → seek to segment end.
// Pure component — positionShared + segments in, seek callback out.
//
// The active segment is computed on the UI thread via
// useAnimatedReaction, so the component only re-renders when the
// active segment *changes* (enter/exit), not on every position tick.

import type { IntroSkipperSegments } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, radius, spacing } from "@jellyfuse/theme";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import Animated, { useAnimatedReaction, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

interface Props {
  /** UI-thread position mirror — watched via useAnimatedReaction. */
  positionShared: SharedValue<number>;
  segments: IntroSkipperSegments | undefined;
  onSkip: (toSeconds: number) => void;
}

interface ActiveSegment {
  label: string;
  end: number;
}

export function SkipSegmentPill({ positionShared, segments, onSkip }: Props) {
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<ActiveSegment | null>(null);

  useAnimatedReaction(
    () => {
      const pos = positionShared.value;
      if (!segments) return null;
      if (
        segments.introduction &&
        pos >= segments.introduction.start &&
        pos < segments.introduction.end
      ) {
        return { label: "Skip Intro", end: segments.introduction.end };
      }
      if (segments.recap && pos >= segments.recap.start && pos < segments.recap.end) {
        return { label: "Skip Recap", end: segments.recap.end };
      }
      if (segments.credits && pos >= segments.credits.start && pos < segments.credits.end) {
        return { label: "Skip Credits", end: segments.credits.end };
      }
      return null;
    },
    (current, previous) => {
      if (current?.label !== previous?.label || current?.end !== previous?.end) {
        scheduleOnRN(setActive, current);
      }
    },
    [segments],
  );

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
