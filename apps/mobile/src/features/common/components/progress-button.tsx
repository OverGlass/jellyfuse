// Play / Resume button with an optional progress fill. Ports
// `play_button` from `crates/jf-ui-kit/src/components/action_button.rs`:
// a pill with a hard-stop "gradient" revealing how far through the item
// the user is. Jellyfin's canonical resume UX.
//
// The Rust version uses a GPUI linear gradient with two stops at the
// same position — which is just a two-colour hard cutoff. RN has no
// native gradient without a dep, but we don't need one: two absolutely
// positioned Views (fill + track) achieve the identical pixel result.
//
// Colours mirror Rust's constants so the visual matches the reference:
//   WHITE        → #ededed (0.93 luminance) — fresh / completed portion
//   DARK_TRACK   → #525252 (0.32 luminance) — remaining portion when
//                  resume exists
//   DARK_TEXT    → #1a1a1a — label colour, always on the light side
//
// When `progress <= 0.01` the button is solid WHITE (no resume → just
// a normal Play button). Otherwise the track is DARK_TRACK and the
// fill is WHITE clipped to `progress * 100%`.

import { fontSize, fontWeight, opacity } from "@jellyfuse/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

// Match Rust's WHITE / DARK_TRACK / DARK_TEXT exactly (see header).
const FILL_COLOR = "#ededed";
const TRACK_COLOR = "#525252";
const LABEL_COLOR = "#1a1a1a";

interface Props {
  /** Button label (e.g. "Resume", "Play", "Play Now (10s)"). */
  label: string;
  /** 0–1. Below 0.01 the button renders as a solid fill (no track). */
  progress: number;
  onPress: () => void;
  /** Dims the button and blocks presses. */
  disabled?: boolean;
  /** Optional — defaults to `label`. */
  accessibilityLabel?: string;
  /** Pill height + radius. Defaults to 44 / 22 (Rust `ButtonSize::Hero`). */
  height?: number;
}

export function ProgressButton({
  label,
  progress,
  onPress,
  disabled = false,
  accessibilityLabel,
  height = 44,
}: Props) {
  const hasProgress = progress > 0.01;
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const pillRadius = height / 2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.root,
        {
          height,
          borderRadius: pillRadius,
          backgroundColor: hasProgress ? TRACK_COLOR : FILL_COLOR,
        },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {/* Progress fill — only present when resume exists. The parent's
          borderRadius clips this so the fill respects the pill shape
          at both ends (left curve always shows, right curve only when
          progress ≈ 1). */}
      {hasProgress ? (
        <View
          style={[styles.fill, { width: `${clampedProgress * 100}%`, backgroundColor: FILL_COLOR }]}
        />
      ) : null}
      {/* Label sits absolute-centred on top of the fill so the gradient
          background is never pushed around by label width — mirrors
          Rust's `.absolute().inset_0()` overlay. */}
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
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    position: "relative",
  },
  pressed: {
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
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
