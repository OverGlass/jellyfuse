import {
  breakpointForWidth,
  responsive,
  type Breakpoint,
  type ResponsiveValues,
} from "@jellyfuse/theme";
import { useWindowDimensions } from "react-native";

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
