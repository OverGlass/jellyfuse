// JS-rendered subtitle overlay driven by mpv's `sub-text` property.
// Phase 1 of the native video pipeline migration (see
// docs/native-video-pipeline.md): validates the data path that takes
// over sub rendering once Phase 2 stops relying on mpv to composite
// captions into the video frame.
//
// Pure component — caption string in, no callbacks out. Rendered on
// top of the player so it also sits above mpv's own caption draw
// until Phase 2 lands; the two overlap intentionally during the
// migration so we can compare rendering side by side.

import { colors, fontSize, spacing, withAlpha } from "@jellyfuse/theme";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface Props {
  /** Current caption from mpv. Empty string hides the overlay. */
  text: string;
}

export function SubtitleOverlay({ text }: Props) {
  const insets = useSafeAreaInsets();
  if (!text) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.container, { bottom: Math.max(insets.bottom, spacing.lg) + 100 }]}
    >
      <Text style={styles.caption}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: spacing.xl,
  },
  caption: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: "600",
    textAlign: "center",
    // Black outline via shadow — mimics the mpv/YouTube caption look
    // so white text stays legible over bright backgrounds.
    textShadowColor: withAlpha(colors.black, 0.75),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
