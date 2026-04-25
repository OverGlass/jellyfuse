// Up Next countdown button — fill width animates entirely on the UI
// thread via a SharedValue. The JS thread never re-renders during the
// 10s countdown; only the press handler and the static label cross
// the bridge.
//
// Visual matches `play_button` from
// `crates/jf-ui-kit/src/components/action_button.rs` — a pill with a
// hard-stop two-colour split. Two layers (track + fill) reproduce the
// gradient pixel-perfectly without a gradient dep.

import { fontSize, fontWeight, opacity } from "@jellyfuse/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useEndOfEpisode } from "../state/end-of-episode-context";

const FILL_COLOR = "#ededed";
const TRACK_COLOR = "#525252";
const LABEL_COLOR = "#1a1a1a";
const HEIGHT = 44;
const RADIUS = HEIGHT / 2;

interface Props {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}

export function CountdownPill({ label, onPress, accessibilityLabel }: Props) {
  const { progressShared } = useEndOfEpisode();
  const fillStyle = useAnimatedStyle(() => {
    const p = progressShared.value;
    const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
    return { width: `${clamped * 100}%` };
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [styles.root, pressed && styles.pressed]}
    >
      <Animated.View style={[styles.fill, fillStyle]} />
      <View style={styles.labelWrap} pointerEvents="none">
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
    height: HEIGHT,
    borderRadius: RADIUS,
    backgroundColor: TRACK_COLOR,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    position: "relative",
  },
  pressed: {
    opacity: opacity.pressed,
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: FILL_COLOR,
  },
  labelWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: LABEL_COLOR,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
});
