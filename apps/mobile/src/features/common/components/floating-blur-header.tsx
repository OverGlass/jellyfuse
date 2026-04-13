import MaskedView from "@react-native-masked-view/masked-view";
import { colors, spacing } from "@jellyfuse/theme";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { type LayoutChangeEvent, StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { type AnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Reusable floating top-of-screen header with a gradient-masked
 * native blur backdrop. Ports the Rust `JFSearchBridge.m` pattern
 * (UIVisualEffectView + CAGradientLayer mask) to React Native:
 *
 * - `MaskedView` + `LinearGradient` alpha mask, opaque through 70%
 *   of the container height and fading to transparent at the
 *   bottom, so the blur dissolves smoothly into the scrolling
 *   content below rather than cutting off hard.
 * - `BlurView tint="dark" intensity={80}` as the masked child.
 * - Safe-area top padding + a 24 dp fade zone padding at the bottom
 *   so the mask has room to fade beneath whatever content the
 *   parent provides.
 *
 * The parent passes a Reanimated animated style to control reveal
 * (opacity + translateY, typically driven by a scroll offset vs a
 * measured stick point). This component knows nothing about scroll
 * — it just renders a pinned blur header — which lets the same
 * component power the series detail's sticky season tabs, the
 * home screen's pinned search bar, and anywhere else we need a
 * Rust-style floating blur.
 *
 * Children render on top of the masked blur in natural flow with
 * the safe-area padding already applied. They should include their
 * own horizontal padding via `useScreenGutters` since this
 * component is content-agnostic horizontally.
 */
interface Props {
  style?: AnimatedStyle<ViewStyle>;
  children: ReactNode;
  /**
   * Fires whenever the header's total rendered height changes —
   * including the safe-area top inset and the internal fade-zone
   * padding. Consumers use this to push their scroll content's
   * `paddingTop` so nothing renders behind the blur. The value is
   * the `Animated.View`'s own height in dp.
   */
  onTotalHeightChange?: (height: number) => void;
}

export function FloatingBlurHeader({ style, children, onTotalHeightChange }: Props) {
  const insets = useSafeAreaInsets();

  function handleLayout(event: LayoutChangeEvent) {
    if (onTotalHeightChange) {
      onTotalHeightChange(event.nativeEvent.layout.height);
    }
  }

  return (
    <Animated.View style={[styles.root, style]} onLayout={handleLayout}>
      {/* Layer 1 — masked native blur. The linear-gradient alpha
          mask is `["black", "black", "transparent"]` at locations
          `[0, 0.7, 1]`, identical to the `CAGradientLayer` mask on
          the `UIVisualEffectView` in `JFSearchBridge.m::createBlurContainer`. */}
      <MaskedView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        maskElement={
          <LinearGradient
            colors={["black", "black", "transparent"]}
            locations={[0, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
        }
      >
        <BlurView tint="dark" intensity={80} style={StyleSheet.absoluteFill} />
      </MaskedView>

      {/* Layer 2 — content in natural flow above the masked blur.
          Safe-area top + 24 dp bottom fade zone. Horizontal padding
          is the caller's responsibility (they know whether to use
          gutters, clearance, etc). */}
      <View
        style={{
          paddingTop: insets.top + spacing.sm,
          paddingBottom: spacing.lg,
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
    // Above StatusBarScrim (zIndex 5), below BackButton (zIndex 10).
    // Callers that want their own stacking can override via the
    // `style` prop.
    zIndex: 6,
  },
});
