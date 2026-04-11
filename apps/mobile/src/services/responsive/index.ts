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
 * Screen gutters that also respect the notch / Dynamic Island / nav-bar
 * insets. Returns the max of `responsive.screenPaddingHorizontal` and
 * the live safe-area insets so content doesn't slide under the notch
 * when the device is rotated into landscape (the Dynamic Island moves
 * to the leading edge, and iPhone landscape also picks up the home
 * indicator on the trailing edge).
 *
 * Use this at every screen container + every horizontally-scrolling
 * list's `contentContainerStyle.paddingLeft/Right`.
 */
export function useScreenGutters(): { left: number; right: number; top: number; bottom: number } {
  const { values } = useBreakpoint();
  const insets = useSafeAreaInsets();
  return {
    left: Math.max(values.screenPaddingHorizontal, insets.left),
    right: Math.max(values.screenPaddingHorizontal, insets.right),
    top: insets.top,
    bottom: insets.bottom,
  };
}
