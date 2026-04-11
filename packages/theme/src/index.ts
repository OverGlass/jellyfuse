// @jellyfuse/theme — design tokens shared between apps/mobile and apps/web.
// Phase 0a/b ships the core scales (spacing, colors, typography). The full
// palette, dark/light schemes, and component tokens land alongside the first
// real UI components in Phase 2.

/** Spacing scale in dp. Monotonic. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;
export type Spacing = keyof typeof spacing;

/** Font size scale in dp. Monotonic. */
export const fontSize = {
  caption: 12,
  body: 14,
  bodyLarge: 16,
  subtitle: 18,
  title: 24,
  display: 32,
} as const;
export type FontSize = keyof typeof fontSize;

/** Font weights. RN accepts string values. */
export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;
export type FontWeight = keyof typeof fontWeight;

/**
 * Screen-level layout tokens. These govern page rhythm (top padding under
 * the safe area, horizontal gutters, space between sections) so individual
 * screens never hard-code their own numbers. Any screen that wants to
 * align with the rest of the app should pull from here instead of
 * reaching into `spacing` directly for page-level offsets.
 */
export const layout = {
  /** Top padding applied under the safe area before the screen heading. */
  screenPaddingTop: 24,
  /** Horizontal gutter for screen content against the safe area edges. */
  screenPaddingHorizontal: 24,
  /** Bottom padding for the last screen element above the safe area. */
  screenPaddingBottom: 32,
  /** Vertical space between a screen heading and the body content. */
  headingToBody: 32,
  /** Minimum height for primary CTA buttons. */
  buttonHeight: 52,
} as const;
export type LayoutToken = keyof typeof layout;

/**
 * Corner radius scale. `full` is a sentinel large number — pass it as
 * `borderRadius` to clip a square into a circle (RN clamps to
 * `min(width, height) / 2`).
 */
export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 16,
  full: 9999,
} as const;
export type RadiusToken = keyof typeof radius;

/**
 * Opacity values for interactive state. Use `pressed` in `Pressable`
 * style callbacks, `disabled` for the dimmed state of inactive
 * actions, `overlay` for dimming content behind modals.
 */
export const opacity = {
  pressed: 0.75,
  disabled: 0.5,
  overlay: 0.4,
} as const;
export type OpacityToken = keyof typeof opacity;

/**
 * Animation durations in ms. Pair with easing where RN lets us; use
 * raw ints where it doesn't (e.g. `expo-image` `transition`).
 */
export const duration = {
  fast: 120,
  normal: 200,
  slow: 320,
} as const;
export type DurationToken = keyof typeof duration;

/**
 * One Dark Pro **Darker** palette, ported from
 * https://github.com/Binaryify/OneDark-Pro/blob/master/themes/OneDark-Pro-darker.json
 *
 * Single dark theme (no light variant) using the OneDark Darker editor
 * chrome + OneDark syntax colors. The darker variant drops the editor
 * background ~1 step lower than the standard OneDark Pro, which suits
 * a full-screen media client where we want the UI to recede and cover
 * art to dominate the page.
 *
 * Surface tokens come from the editor chrome (`editor.background`,
 * `editorGroupHeader.tabsBackground`, `editor.lineHighlightBackground`,
 * `editorGroup.border`, `focusBorder`). Text tokens come from the
 * editor foreground + list + muted comment colors. `accent` is the
 * OneDark blue (hyperlinks / hover highlights); semantic tokens map
 * to the standard OneDark syntax red / green / orange.
 *
 * **Contrast rationale** (approximate, measured against `background`
 * `#23272e` unless noted):
 * - `textPrimary #d7dae0` — 12.6:1 (AAA)
 * - `textSecondary #abb2bf` — 8.2:1 (AAA)
 * - `accent #61afef` — 7.8:1 (AAA)
 * - `accentContrast #181a1f` on `accent` — 8.4:1 (AAA) — used for CTA
 *   button labels so primary actions stay legible.
 * - `danger` / `success` / `warning` all clear 4.5:1 on `background`.
 */
export const colors = {
  // Surfaces — OneDark Pro Darker editor chrome ---------------------
  // Inverted from the editor mapping: we want the *page* to sit on
  // the darkest neutral (sidebar) and *cards* to lift up onto the
  // editor background so they feel like floating surfaces over the
  // page — which matches how a media client composes: posters and
  // player UI need to pop against a near-black page.
  /** Page / app background (sideBar.background — the darker neutral). */
  background: "#1e2227",
  /** Elevated surface: cards, sheets, inputs (editor.background). */
  surface: "#23272e",
  /** Second elevation (hovered/pressed card, editor.lineHighlightBackground). */
  surfaceElevated: "#2c313c",
  /** Hairline border / subtle divider (editorGroup.border). */
  border: "#181a1f",

  // Text -------------------------------------------------------------
  /** Primary text (list.activeSelectionForeground). 12.6:1. */
  textPrimary: "#d7dae0",
  /** Secondary text (editor.foreground). 8.2:1. */
  textSecondary: "#abb2bf",
  /** Muted text (comments / word highlight border). */
  textMuted: "#7f848e",

  // Brand / CTA — OneDark blue ---------------------------------------
  /** Brand accent (OneDark blue, used for hyperlinks + focus rings). */
  accent: "#61afef",
  /** Pressed / active state for accent surfaces (editorCursor.foreground). */
  accentPressed: "#528bff",
  /** Foreground on top of `accent` surfaces — the darker group border. */
  accentContrast: "#181a1f",

  // Semantic — OneDark syntax colors ---------------------------------
  /** Success (OneDark green — string/char literal color). */
  success: "#98c379",
  /** Warning (OneDark orange — numeric/constant color). */
  warning: "#d19a66",
  /** Destructive / error (OneDark red — keyword/tag color). */
  danger: "#e06c75",
} as const;
export type ColorToken = keyof typeof colors;

/**
 * Profile avatar palette. Sourced directly from the OneDark syntax
 * colors (red / orange / yellow / green / cyan / blue / purple) plus
 * the darker OneDark "atom" red, giving eight well-separated hues that
 * feel native to the rest of the palette. Used as a background color
 * for `ProfileTile` fallback avatars when a user has no Jellyfin
 * primary image.
 *
 * Map a user id to a stable entry via `profileColorFor(userId)` so
 * each user always gets the same tile color across app launches.
 */
export const profilePalette = [
  "#e06c75", // red
  "#d19a66", // orange
  "#e5c07b", // yellow
  "#98c379", // green
  "#56b6c2", // cyan
  "#61afef", // blue
  "#c678dd", // purple
  "#be5046", // dark red (atom)
] as const;
export type ProfileColor = (typeof profilePalette)[number];

/**
 * Deterministic mapping of a seed string (typically a Jellyfin user
 * id) to an entry in `profilePalette`. Uses a cheap FNV-1a hash so
 * the same seed always resolves to the same color — including across
 * cold launches and across platforms.
 */
export function profileColorFor(seed: string): ProfileColor {
  let hash = 0x811c9dc5; // FNV-1a offset basis (32-bit)
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const index = Math.abs(hash) % profilePalette.length;
  // Safe: index is bounded by the palette length above, and the
  // palette is non-empty at compile time.
  return profilePalette[index] as ProfileColor;
}
