import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { readScrollState, writeScrollState } from "@/services/nav-state/store";

/**
 * Minimal shape of a scrollable we can restore — FlashList and
 * Animated.ScrollView both expose a `scrollToOffset` method on
 * their refs, which is all the hook needs. Declaring a narrow
 * interface avoids pulling the full FlashList generic type plumbing
 * into this file and lets future callers pass any scroller with the
 * same method.
 */
interface Scrollable {
  scrollToOffset: (args: { offset: number; animated: boolean }) => void;
}

/**
 * Hook that preserves a scroll offset across back-nav. Mirrors
 * `crates/jf-ui-kit/src/nav_state.rs` in the Rust impl: on blur
 * we write the current offset to the MMKV nav-state store; on
 * focus we read it back and scroll to that position after the
 * first layout.
 *
 * Returns:
 * - `ref`: a FlashList ref to attach (for scrollToOffset)
 * - `onScroll`: an onScroll handler that tracks offset in a ref
 * - `onContentSizeChange`: fired when content is first laid out;
 *   triggers the restore after layout is stable
 *
 * Usage:
 *
 * ```tsx
 * const { ref, onScroll, onContentSizeChange } = useRestoredScroll("/shelf/latest-movies");
 * <FlashList ref={ref} onScroll={onScroll} onContentSizeChange={onContentSizeChange} />
 * ```
 *
 * `routeKey` should be the full path incl. params — e.g.
 * `/shelf/latest-movies`, `/detail/series/abc123`. Two different
 * entry points get their own saved state. Pass an extra
 * discriminator via a string suffix if a route hosts multiple
 * scrollers (e.g. `/detail/series/abc123#episodes`).
 */

export interface RestoredScroll {
  ref: (instance: Scrollable | null) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: (w: number, h: number) => void;
}

export function useRestoredScroll(routeKey: string): RestoredScroll {
  // Current offset is tracked in a plain ref so React Compiler
  // doesn't need to memoise the onScroll handler.
  const offsetRef = useRef(0);
  const listRef = useRef<Scrollable | null>(null);
  const restoredRef = useRef(false);

  // On focus: reset the "restored" flag so the next content-size
  // change triggers a fresh restore. On blur: write the last known
  // offset to MMKV. `useFocusEffect` is React Navigation's
  // focus/blur lifecycle, not a regular useEffect, so this doesn't
  // violate the "no useEffect for async" rule — the store writes
  // are synchronous MMKV calls.
  useFocusEffect(
    useCallback(() => {
      restoredRef.current = false;
      return () => {
        writeScrollState(routeKey, { offset: offsetRef.current });
      };
    }, [routeKey]),
  );

  const ref = useCallback((instance: Scrollable | null) => {
    listRef.current = instance;
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (restoredRef.current) return;
    const saved = readScrollState(routeKey);
    if (!saved || saved.offset <= 0) {
      restoredRef.current = true;
      return;
    }
    const list = listRef.current;
    if (!list) return;
    // First layout is now stable — scroll to the saved offset
    // without animating so the user doesn't see a flash.
    list.scrollToOffset({ offset: saved.offset, animated: false });
    restoredRef.current = true;
  }, [routeKey]);

  return { ref, onScroll, onContentSizeChange };
}
