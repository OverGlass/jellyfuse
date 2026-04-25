// Owns the end-of-episode store and wires it into the player runtime.
//
// The countdown runs entirely on the UI thread:
//   - `progressShared` is a SharedValue<number> in [0, 1] that
//     `CountdownPill` reads via useAnimatedStyle. No JS render churn
//     during the 10s countdown.
//   - One `useFrameCallback` advances `progressShared` per renderer
//     frame, gated by `activeShared`. The frame callback is always
//     registered (cheaper than start/stop juggling for a 10s window)
//     and short-circuits in ~3 ops when idle.
//   - The trigger reaction calls the pure `targetPhase` gate so the
//     same logic is unit-tested and inlined into the worklet.
//   - On rollover the worklet schedules a single JS-thread trampoline
//     that calls store.complete() and the latest onAutoplay through
//     a ref — no UI-thread ref access, one transition.
//
// Phase transitions are JS-side (the snapshot drives which component
// renders); they only happen on enter, dismiss, reset, complete.

import { useEffect, useMemo, useRef } from "react";
import {
  useAnimatedReaction,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { targetPhase } from "../state/end-of-episode-gate";
import {
  COUNTDOWN_SECONDS,
  createEndOfEpisodeStore,
  type EndOfEpisodeStore,
} from "../state/end-of-episode-store";

interface CreditsSegment {
  start: number;
  end: number;
}

interface Args {
  positionShared: SharedValue<number>;
  durationShared: SharedValue<number>;
  creditsSegment: CreditsSegment | undefined;
  hasNext: boolean;
  isPlaying: boolean;
  onAutoplay: () => void;
}

export interface EndOfEpisodeFlow {
  store: EndOfEpisodeStore;
  /** UI-thread countdown progress in [0, 1]. Driven by a frame callback. */
  progressShared: SharedValue<number>;
}

export function useEndOfEpisodeFlow({
  positionShared,
  durationShared,
  creditsSegment,
  hasNext,
  isPlaying,
  onAutoplay,
}: Args): EndOfEpisodeFlow {
  const store = useMemo(createEndOfEpisodeStore, []);

  // UI-thread mirrors. Each is wrapped in an effect so we only sync on
  // actual change — not on every parent re-render (player-screen
  // re-renders often as playback metadata streams in).
  const creditsStart = useSharedValue(-1);
  const creditsEnd = useSharedValue(-1);
  const hasNextShared = useSharedValue(0);
  const playingShared = useSharedValue(0);
  // Frame-callback gate. Two writers, one logical event each:
  //   JS: opens (1) on phase entry, closes (0) on phase exit.
  //   Worklet: closes (0) on rollover so a queued frame can't tick a
  //   second time while JS is still catching up to store.complete().
  // Both write the same 0/1 for the same conceptual state, so the
  // races only ever resolve to "closed", never to a wrong-value tick.
  const activeShared = useSharedValue(0);
  const progressShared = useSharedValue(0);
  const lastPositionShared = useSharedValue(0);

  useEffect(() => {
    creditsStart.value = creditsSegment?.start ?? -1;
    creditsEnd.value = creditsSegment?.end ?? -1;
  }, [creditsStart, creditsEnd, creditsSegment?.start, creditsSegment?.end]);
  useEffect(() => {
    hasNextShared.value = hasNext ? 1 : 0;
  }, [hasNextShared, hasNext]);
  useEffect(() => {
    playingShared.value = isPlaying ? 1 : 0;
  }, [playingShared, isPlaying]);

  // JS-thread trampoline for the rollover edge. Worklet captures this
  // function reference at workletization time; the function reads the
  // latest onAutoplay through a ref on the JS thread, so the worklet
  // never touches a JS ref directly. One scheduled call covers both
  // store mutation and navigation as a single transition.
  const onAutoplayRef = useRef(onAutoplay);
  onAutoplayRef.current = onAutoplay;
  const handleRolloverJS = () => {
    store.complete();
    onAutoplayRef.current();
  };

  useAnimatedReaction(
    () => {
      const position = positionShared.value;
      // Backward-seek detection. The reset action happens inline so
      // the next iteration sees the cleared snapshot. We update
      // lastPositionShared at the end so steady playback doesn't trip
      // the threshold.
      if (position < lastPositionShared.value - 2) {
        scheduleOnRN(store.reset);
      }
      lastPositionShared.value = position;
      return targetPhase({
        position,
        duration: durationShared.value,
        creditsStart: creditsStart.value,
        creditsEnd: creditsEnd.value,
        hasNext: hasNextShared.value === 1 ? 1 : 0,
      });
    },
    (target, previous) => {
      if (target === previous) return;
      if (target === 1) scheduleOnRN(store.enter, "credits");
      else if (target === 2) scheduleOnRN(store.enter, "nearEnd");
    },
  );

  // UI-thread countdown. Always-on frame callback, gated by
  // `activeShared` so the early-return is a few ops while idle. On
  // rollover the worklet closes the gate inline — frames N+1..N+M
  // (until JS confirms `complete()`) bail at the gate check.
  useFrameCallback((info) => {
    "worklet";
    if (activeShared.value !== 1) return;
    if (playingShared.value !== 1) return;
    const deltaMs = info.timeSincePreviousFrame ?? 16;
    const next = progressShared.value + deltaMs / 1000 / COUNTDOWN_SECONDS;
    if (next >= 1) {
      activeShared.value = 0;
      progressShared.value = 0;
      scheduleOnRN(handleRolloverJS);
      return;
    }
    progressShared.value = next;
  }, true);

  // Phase → gate sync. Subscribes to the store and toggles
  // activeShared + resets progressShared on entry/exit. JS is the
  // canonical writer for entry; the worklet's rollover write closes
  // the gate ahead of JS — both are idempotent at this level.
  useEffect(() => {
    const apply = () => {
      const nowActive = store.getSnapshot().phase !== "idle";
      const wasActive = activeShared.value === 1;
      if (nowActive && !wasActive) {
        progressShared.value = 0;
        activeShared.value = 1;
      } else if (!nowActive && wasActive) {
        activeShared.value = 0;
        progressShared.value = 0;
      }
    };
    apply();
    return store.subscribe(apply);
  }, [store, activeShared, progressShared]);

  return { store, progressShared };
}
