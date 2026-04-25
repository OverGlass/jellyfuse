// End-of-episode overlay state — Watch Credits + Up Next countdown.
//
// Three phases (idle / credits / nearEnd), two dismiss latches.
// Mirrors the four flags from Rust's PlayerView in
// `crates/jf-ui-kit/src/views/player/mod.rs`:
//
//   show_up_next               → derived from `phase !== "idle"`
//   up_next_credits_dismissed  → `creditsDismissed`
//   up_next_dismissed          → `nearEndDismissed`
//   up_next_elapsed            → owned by the UI-thread progress
//                                SharedValue in `useEndOfEpisodeFlow`,
//                                NOT by this store. The countdown
//                                animates on the renderer thread; this
//                                store only tracks the discrete
//                                phase/latch state.
//
// Pure: no React, no Reanimated, no native bindings. Components read
// the snapshot via `useSyncExternalStore`; the worklet driving phase
// transitions goes through these mutators via `scheduleOnRN`.
//
// Mutator references are stable for the life of the store, which lets
// React Compiler and worklet `scheduleOnRN` capture them without
// identity churn.

export type Phase = "idle" | "credits" | "nearEnd";

export const COUNTDOWN_SECONDS = 10;

export interface EndOfEpisodeSnapshot {
  phase: Phase;
  creditsDismissed: boolean;
  nearEndDismissed: boolean;
}

export interface EndOfEpisodeStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => EndOfEpisodeSnapshot;
  enter: (phase: "credits" | "nearEnd") => void;
  /** Countdown reached COUNTDOWN_SECONDS — clear phase without latching dismiss flags. */
  complete: () => void;
  watchCredits: () => void;
  dismiss: () => void;
  reset: () => void;
}

const INITIAL_SNAPSHOT: EndOfEpisodeSnapshot = {
  phase: "idle",
  creditsDismissed: false,
  nearEndDismissed: false,
};

export function createEndOfEpisodeStore(): EndOfEpisodeStore {
  let snapshot: EndOfEpisodeSnapshot = INITIAL_SNAPSHOT;
  const listeners = new Set<() => void>();

  function emit(next: EndOfEpisodeSnapshot) {
    if (next === snapshot) return;
    snapshot = next;
    for (const l of listeners) l();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    enter(target) {
      // Guard against re-entry and dismissed paths. Worklets are
      // allowed to be optimistic; the store enforces invariants.
      if (snapshot.phase === target) return;
      if (target === "credits" && snapshot.creditsDismissed) return;
      if (target === "nearEnd" && snapshot.nearEndDismissed) return;
      emit({ ...snapshot, phase: target });
    },
    complete() {
      // Rollover from a UI-thread countdown. Clears the phase but
      // leaves dismissed flags alone — the *next* time the same window
      // is entered (after a backward seek), the latch is open again.
      if (snapshot.phase === "idle") return;
      emit({ ...snapshot, phase: "idle" });
    },
    watchCredits() {
      // Idempotent — only meaningful while the credits-path is live,
      // but setting the flag from any phase is harmless and matches
      // Rust's "click locks the segment out" semantics.
      emit({
        ...snapshot,
        phase: "idle",
        creditsDismissed: true,
      });
    },
    dismiss() {
      // Whichever path is active gets latched off. Both flags update
      // so re-entry into either window can't re-trigger this episode.
      if (snapshot.phase === "idle") return;
      const isCredits = snapshot.phase === "credits";
      emit({
        ...snapshot,
        phase: "idle",
        creditsDismissed: snapshot.creditsDismissed || isCredits,
        nearEndDismissed: snapshot.nearEndDismissed || !isCredits,
      });
    },
    reset() {
      // Backward seek > 2s. Mirrors Rust mod.rs L336–341: every flag
      // clears so a forward scrub back into the window can re-trigger.
      emit(INITIAL_SNAPSHOT);
    },
  };
}
