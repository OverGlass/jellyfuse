// Pure gate for the end-of-episode trigger. Given the current playback
// position + episode metadata, returns which phase (if any) should be
// active. Identical logic is invoked from a Reanimated worklet, so it
// must stay pure and synchronous: no closures over state, no JS-side
// calls. The 'worklet' directive lets Reanimated inline it from the
// position-watching reaction.
//
// Mirrors Rust's gates from `crates/jf-ui-kit/src/views/player/mod.rs`:
//   - Credits path: in_credits && has_next   (L614–625)
//   - Near-end path: remaining ∈ [MIN_REMAINING, showAt(duration)] AND
//     position is past credits.end if credits exist  (L716–768)

export type TargetPhase = 0 | 1 | 2; // 0 = idle, 1 = credits, 2 = nearEnd

export const MIN_DURATION = 600;
export const MIN_REMAINING = 20;

interface GateInput {
  position: number;
  duration: number;
  creditsStart: number; // -1 when no credits segment
  creditsEnd: number; // -1 when no credits segment
  hasNext: 0 | 1;
}

export function targetPhase(input: GateInput): TargetPhase {
  "worklet";
  const { position, duration, creditsStart, creditsEnd, hasNext } = input;
  if (duration <= 0) return 0;

  const inCredits =
    creditsStart >= 0 &&
    creditsEnd > creditsStart &&
    position >= creditsStart &&
    position < creditsEnd;
  if (inCredits && hasNext === 1) return 1;

  if (duration < MIN_DURATION) return 0;
  // Suppress near-end path while inside the credits window so the
  // credits-path takes priority. Past credits.end the near-end window
  // is fair game even though credits exist.
  if (creditsStart >= 0 && creditsEnd > creditsStart && position < creditsEnd) return 0;
  const remaining = duration - position;
  const showAt = duration >= 3000 ? 40 : duration >= 2400 ? 35 : 30;
  if (remaining <= showAt && remaining >= MIN_REMAINING) return 2;

  return 0;
}
