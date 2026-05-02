// Shared layout constants used across sections.

export const CONTAINER_MAX_WIDTH = 1200;

// Responsive gutter — clamp(20px, 4vw, 48px). RNW passes the string
// through to CSS so `paddingHorizontal: GUTTER` works as expected on
// the web target.
export const GUTTER = "clamp(20px, 4vw, 48px)" as unknown as number;

// Hairline rgba — text-primary @ 8% alpha. The design's `--hairline`.
// (Codified in `packages/theme` as `opacity.alpha08`; this is the
//  pre-composed string for places that need a literal CSS color.)
export const HAIRLINE = "rgba(215,218,224,0.08)";
