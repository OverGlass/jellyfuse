/**
 * `useFloatingHeaderScroll` — shared scroll + header-height plumbing
 * used by every screen that puts a `ScreenHeader` (floating blur) over
 * a scrollable list.
 *
 * Factored out to kill the copy-paste pattern that was in home, shelf,
 * requests, and downloads:
 *
 *   1. `useState` + `handleHeaderHeightChange` (with a 0.5dp threshold
 *      so a ResizeObserver-style jitter doesn't rerender every frame).
 *   2. `useSharedValue` + `useAnimatedScrollHandler` to track `scrollY`.
 *   3. `useAnimatedStyle` → `interpolate(scrollY, [0, 60], [0, 1])` →
 *      feeds the header backdrop opacity so the blur fades in as the
 *      user scrolls past the fold.
 *
 * Returns:
 * - `headerHeight` — measured total header height (dp). Pipe into
 *   `contentContainerStyle.paddingTop` so the first row doesn't start
 *   hidden under the blur.
 * - `onHeaderHeightChange` — pass to `<ScreenHeader onTotalHeightChange>`.
 * - `scrollY` — the Reanimated `SharedValue<number>` that tracks the
 *   native scroll offset. Exposed so screens that need extra side-effects
 *   (e.g. `useRestoredScroll.setOffset`) can compose their own handler.
 * - `scrollHandler` — default animated scroll handler that just updates
 *   `scrollY`. Use directly for simple screens; screens that need
 *   side-effects should ignore this and write their own handler against
 *   the returned `scrollY`.
 * - `backdropStyle` — animated style for the `ScreenHeader.backdropStyle`
 *   prop. Ramps opacity from 0 → 1 across the first `BLUR_FADE_END` dp
 *   of scroll.
 *
 * The fade threshold is fixed at 60 dp (matching the native iOS large-
 * title transition) so every screen has the same feel. If a screen ever
 * needs a different value, add it as a param — don't inline an override.
 */
import { useCallback, useState } from "react";
import type { ViewStyle } from "react-native";
import {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type AnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

const BLUR_FADE_END = 60;

export interface FloatingHeaderScroll {
  headerHeight: number;
  onHeaderHeightChange: (next: number) => void;
  scrollY: SharedValue<number>;
  scrollHandler: ReturnType<typeof useAnimatedScrollHandler>;
  backdropStyle: AnimatedStyle<ViewStyle>;
}

export function useFloatingHeaderScroll(): FloatingHeaderScroll {
  const [headerHeight, setHeaderHeight] = useState(0);
  const onHeaderHeightChange = useCallback((next: number) => {
    setHeaderHeight((current) => (Math.abs(next - current) > 0.5 ? next : current));
  }, []);

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
    },
  });

  const backdropStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: interpolate(scrollY.value, [0, BLUR_FADE_END], [0, 1], Extrapolation.CLAMP),
    };
  });

  return {
    headerHeight,
    onHeaderHeightChange,
    scrollY,
    scrollHandler,
    backdropStyle,
  };
}
