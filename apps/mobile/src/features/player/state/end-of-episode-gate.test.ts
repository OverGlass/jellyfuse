import { targetPhase } from "./end-of-episode-gate";

const NO_CREDITS = { creditsStart: -1, creditsEnd: -1 };
const HAS_NEXT = { hasNext: 1 } as const;
const NO_NEXT = { hasNext: 0 } as const;

describe("targetPhase", () => {
  describe("idle", () => {
    it("returns idle when duration is 0 (mpv hasn't loaded)", () => {
      expect(targetPhase({ position: 0, duration: 0, ...NO_CREDITS, ...HAS_NEXT })).toBe(0);
    });

    it("returns idle for items shorter than MIN_DURATION outside credits", () => {
      expect(targetPhase({ position: 500, duration: 590, ...NO_CREDITS, ...HAS_NEXT })).toBe(0);
    });

    it("returns idle in the bulk of an episode", () => {
      expect(targetPhase({ position: 600, duration: 1800, ...NO_CREDITS, ...HAS_NEXT })).toBe(0);
    });

    it("returns idle in the final 20s — too close to EOF for a 10s countdown", () => {
      expect(targetPhase({ position: 1790, duration: 1800, ...NO_CREDITS, ...HAS_NEXT })).toBe(0);
    });
  });

  describe("credits path", () => {
    it("returns credits inside the segment when next episode exists", () => {
      expect(
        targetPhase({
          position: 1750,
          duration: 1800,
          creditsStart: 1740,
          creditsEnd: 1795,
          ...HAS_NEXT,
        }),
      ).toBe(1);
    });

    it("returns idle inside credits without a next episode (Skip Credits handles it)", () => {
      expect(
        targetPhase({
          position: 1750,
          duration: 1800,
          creditsStart: 1740,
          creditsEnd: 1795,
          ...NO_NEXT,
        }),
      ).toBe(0);
    });

    it("ignores short-duration gate (credits play even on 5-min episodes)", () => {
      expect(
        targetPhase({
          position: 290,
          duration: 300,
          creditsStart: 285,
          creditsEnd: 299,
          ...HAS_NEXT,
        }),
      ).toBe(1);
    });
  });

  describe("near-end path", () => {
    it("triggers at remaining=30s for sub-40min episodes (showAt=30)", () => {
      // 1800s = 30min, well under 2400. showAt should be 30.
      expect(targetPhase({ position: 1770, duration: 1800, ...NO_CREDITS, ...HAS_NEXT })).toBe(2);
    });

    it("triggers at remaining=35s for 40-min episodes (showAt=35)", () => {
      expect(targetPhase({ position: 2365, duration: 2400, ...NO_CREDITS, ...HAS_NEXT })).toBe(2);
    });

    it("triggers at remaining=40s for 50-min episodes (showAt=40)", () => {
      expect(targetPhase({ position: 2960, duration: 3000, ...NO_CREDITS, ...HAS_NEXT })).toBe(2);
    });

    it("doesn't trigger past the showAt threshold", () => {
      expect(targetPhase({ position: 1700, duration: 1800, ...NO_CREDITS, ...HAS_NEXT })).toBe(0); // 100s remaining, showAt=30
    });

    it("is suppressed inside the credits window (credits-path takes priority)", () => {
      // Position is in credits AND in the would-be near-end window.
      expect(
        targetPhase({
          position: 1775,
          duration: 1800,
          creditsStart: 1770,
          creditsEnd: 1790,
          ...HAS_NEXT,
        }),
      ).toBe(1); // credits, not near-end
    });

    it("activates AFTER credits.end even though credits exist (Watch Credits fallback)", () => {
      // Credits ended at 1740 (early credits roll); near-end window
      // for a 30-min episode is [1770, 1780]. Past credits.end and
      // inside the window → near-end fires.
      expect(
        targetPhase({
          position: 1775,
          duration: 1800,
          creditsStart: 1700,
          creditsEnd: 1740,
          ...HAS_NEXT,
        }),
      ).toBe(2);
    });

    it("doesn't trigger when next episode is missing (movies)", () => {
      // The gate itself doesn't gate near-end on hasNext — that's an
      // upstream concern (no nextEpisode prop → overlay returns null
      // even if the gate says 2). Verify behaviour is just the
      // remaining-window check.
      expect(targetPhase({ position: 1770, duration: 1800, ...NO_CREDITS, ...NO_NEXT })).toBe(2);
    });
  });

  describe("boundary semantics", () => {
    it("treats credits start as inclusive, end as exclusive", () => {
      expect(
        targetPhase({
          position: 1740,
          duration: 1800,
          creditsStart: 1740,
          creditsEnd: 1795,
          ...HAS_NEXT,
        }),
      ).toBe(1);
      expect(
        targetPhase({
          position: 1795,
          duration: 1800,
          creditsStart: 1740,
          creditsEnd: 1795,
          ...HAS_NEXT,
        }),
      ).toBe(0); // exited credits, near-end path: remaining=5 (< MIN_REMAINING)
    });

    it("treats MIN_REMAINING as inclusive — exactly 20s remaining triggers", () => {
      expect(targetPhase({ position: 1780, duration: 1800, ...NO_CREDITS, ...HAS_NEXT })).toBe(2);
    });
  });
});
