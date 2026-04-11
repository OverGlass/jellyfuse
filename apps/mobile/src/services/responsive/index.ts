import {
  breakpointForWidth,
  responsive,
  type Breakpoint,
  type ResponsiveValues,
} from "@jellyfuse/theme";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type { Breakpoint, ResponsiveValues };

/**
 * Hook returning the current breakpoint + its responsive values.
 * Recomputes automatically on rotation / window resize (iPad multitasking,
 * Mac Catalyst window drag, Android TV aspect changes) because
 * `useWindowDimensions` subscribes to dimension events under the hood.
 *
 * Usage:
 *
 * ```tsx
 * const { breakpoint, values } = useBreakpoint();
 * <View style={{ paddingHorizontal: values.screenPaddingHorizontal }} />
 * ```
 *
 * Prefer `useBreakpoint()` over reading window dimensions directly so
 * the same thresholds live in one place (`@jellyfuse/theme::breakpoints`).
 * React Compiler handles memoisation — no `useMemo` here.
 */
export function useBreakpoint(): { breakpoint: Breakpoint; values: ResponsiveValues } {
  const { width } = useWindowDimensions();
  const breakpoint = breakpointForWidth(width);
  return { breakpoint, values: responsive[breakpoint] };
}

/**
 * Horizontal screen gutters that also respect the notch / Dynamic
 * Island inset. Returns the max of `responsive.screenPaddingHorizontal`
 * and the live safe-area `insets.left/right` so content doesn't slide
 * under the notch when the device is rotated into landscape (the
 * Dynamic Island moves to the leading edge).
 *
 * Use this at every screen container + every horizontally-scrolling
 * list's `contentContainerStyle.paddingLeft/Right`. For vertical
 * (top / bottom) safe-area padding, call `useSafeAreaInsets()` directly
 * — those values aren't merged with any responsive token, so there's
 * no wrapper value to add and routing them through this hook would
 * just obscure intent.
 */
export function useScreenGutters(): { left: number; right: number } {
  const { values } = useBreakpoint();
  const insets = useSafeAreaInsets();
  return {
    left: Math.max(values.screenPaddingHorizontal, insets.left),
    right: Math.max(values.screenPaddingHorizontal, insets.right),
  };
}
