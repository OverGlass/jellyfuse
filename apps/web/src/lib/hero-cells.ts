// Hero background — vesica-cell exhaust pattern, ported from the app icon.
// Many tall lens cells across the full width with the profile-palette
// colour swept across them; bell-curved cell width (wider near centre).
// We compute the path strings and rgba fills once at module scope so the
// hero SVG is fully deterministic and the page is server-renderable
// without running any client-side JS.

const W = 1600;
const H = 900;
const Y_TOP = -H * 0.1; // overshoot top/bottom so cells reach edges
const Y_BOT = H * 1.1;
const CELLS = 22;
const PADDING = W * 0.01;
const SPAN = W - PADDING * 2;
const INTENSITY = 0.65;

// Profile palette — same eight hues used across the app for avatar tiles.
const PROFILE = [
  "#e06c75",
  "#d19a66",
  "#e5c07b",
  "#98c379",
  "#56b6c2",
  "#61afef",
  "#c678dd",
  "#be5046",
] as const;

type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function lerp(a: string, b: string, t: number): Rgb {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return [
    Math.round(A[0] + (B[0] - A[0]) * t),
    Math.round(A[1] + (B[1] - A[1]) * t),
    Math.round(A[2] + (B[2] - A[2]) * t),
  ];
}

function sample(stops: readonly string[], t: number): Rgb {
  const n = stops.length - 1;
  const x = t * n;
  const i = Math.min(Math.floor(x), n - 1);
  const a = stops[i];
  const b = stops[i + 1];
  if (a === undefined || b === undefined) {
    return hexToRgb(stops[0] ?? "#000000");
  }
  return lerp(a, b, x - i);
}

function lensPath(x: number, w: number): string {
  return (
    `M ${x} ${Y_TOP} ` +
    `C ${x + w} ${Y_TOP + H * 0.2}, ${x + w} ${Y_BOT - H * 0.2}, ${x} ${Y_BOT} ` +
    `C ${x - w} ${Y_BOT - H * 0.2}, ${x - w} ${Y_TOP + H * 0.2}, ${x} ${Y_TOP} Z`
  );
}

export type HeroCell = { d: string; fill: string };

function build(): readonly HeroCell[] {
  const out: HeroCell[] = [];
  for (let i = 0; i < CELLS; i++) {
    const t = i / (CELLS - 1);
    const x = PADDING + SPAN * t;
    const bell = 1 - Math.pow(2 * t - 1, 2);
    const w = W * (0.025 + 0.05 * bell);
    const [r, g, b] = sample(PROFILE, t);
    const alpha = (0.1 + 0.14 * bell) * INTENSITY;
    out.push({ d: lensPath(x, w), fill: `rgba(${r},${g},${b},${alpha})` });
  }
  return out;
}

export const HERO_CELLS: readonly HeroCell[] = build();
export const HERO_VIEWBOX = `0 0 ${W} ${H}` as const;
