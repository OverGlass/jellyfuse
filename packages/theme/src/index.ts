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
 * Icon font. `JetBrainsMono Nerd Font Mono` — embedded via
 * expo-font in app.config.ts. Apply as `fontFamily: fontFamily.icon`
 * on a `<Text>` and render one of the `icons.xxx` codepoints.
 *
 * Ports `jf-ui-kit/src/theme.rs::NERD_FONT` + `ICON_*` consts.
 * Codepoints are from the FontAwesome range (`nf-fa-*`).
 */
export const fontFamily = {
  // iOS looks up fonts by their PostScript / family name — NOT the
  // TTF filename. `fc-query` on the file reports "JetBrainsMono
  // Nerd Font Mono" as the family. expo-font registers the font
  // under this name at native-build time.
  icon: "JetBrainsMono Nerd Font Mono",
} as const;

export const icons = {
  home: "\u{F015}", // nf-fa-home
  library: "\u{F03A}", // nf-fa-list_alt
  search: "\u{F002}", // nf-fa-search
  plus: "\u{F067}", // nf-fa-plus
  settings: "\u{F013}", // nf-fa-cog
  close: "\u{F00D}", // nf-fa-times
  arrowLeft: "\u{F060}", // nf-fa-arrow_left
  arrowRight: "\u{F061}", // nf-fa-arrow_right
  chevronLeft: "\u{F053}", // nf-fa-chevron_left
  chevronRight: "\u{F054}", // nf-fa-chevron_right
  play: "\u{F04B}", // nf-fa-play
  pause: "\u{F04C}", // nf-fa-pause
  fastBackward: "\u{F04A}", // nf-fa-fast_backward
  stepBackward: "\u{F048}", // nf-fa-step_backward
  stepForward: "\u{F051}", // nf-fa-step_forward
  fastForward: "\u{F050}", // nf-fa-fast_forward
  volume: "\u{F028}", // nf-fa-volume_up
  music: "\u{F001}", // nf-fa-music
  closedCaptioning: "\u{F20A}", // nf-fa-closed_captioning — subtitle track picker
  language: "\u{F1AB}", // nf-fa-language — audio / subtitle language
  subtitles: "\u{F02D}", // nf-fa-book (kept for back-compat)
  eye: "\u{F06E}", // nf-fa-eye
  download: "\u{F019}", // nf-fa-download
  check: "\u{F00C}", // nf-fa-check
  warning: "\u{F071}", // nf-fa-warning
  list: "\u{F0CB}", // nf-fa-list_ol
  star: "\u{F005}", // nf-fa-star
  heart: "\u{F004}", // nf-fa-heart
  user: "\u{F007}", // nf-fa-user
  trash: "\u{F1F8}", // nf-fa-trash
  refresh: "\u{F021}", // nf-fa-refresh
  bell: "\u{F0F3}", // nf-fa-bell
  cast: "\u{F1B2}", // nf-fa-chromecast (cube glyph; closest to cast in this font)
  share: "\u{F1E0}", // nf-fa-share_alt
  ellipsisVertical: "\u{F142}", // nf-fa-ellipsis_v
  info: "\u{F129}", // nf-fa-info
} as const;
export type IconName = keyof typeof icons;

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
 * Responsive breakpoints in dp. Matches the iOS size-class / Material
 * window-size class split Jellyfuse targets: iPhone portrait → `phone`,
 * iPad portrait → `tablet`, iPad landscape / Mac Catalyst / Android TV
 * → `desktop`. Consumers should reach for `useBreakpoint()` in
 * `apps/mobile/src/services/responsive` instead of comparing raw
 * window widths.
 *
 * Thresholds are inclusive lower bounds (`phone >= 0`, `tablet >= 600`,
 * `desktop >= 1024`) so a 900 dp iPad portrait window is `tablet` and
 * a 1366 dp Catalyst / TV window is `desktop`.
 */
export const breakpoints = {
  phone: 0,
  tablet: 600,
  desktop: 1024,
} as const;
export type Breakpoint = keyof typeof breakpoints;

/**
 * Per-breakpoint responsive layout values used by every screen when
 * a single token isn't enough. Screens look these up via the
 * `useBreakpoint()` hook → `responsive[breakpoint].xxx`.
 *
 * **Principle**: phone is the baseline; tablet/desktop _only_ differ
 * where a responsive change actually matters (wider gutters, larger
 * cards, more columns). Don't fork tokens that work at every size.
 */
export const responsive = {
  phone: {
    /** Horizontal screen gutter. 16 dp is the iOS native content inset. */
    screenPaddingHorizontal: 16,
    /** Shelf grid column count on the "see all" screen. */
    shelfGridColumns: 3,
    /** Poster card (2:3). */
    mediaCardWidth: 104,
    mediaCardPosterHeight: 156,
    /** Wide card (16:9) — used by Continue Watching. */
    wideCardWidth: 224,
    wideCardHeight: 126,
    /** Horizontal gap between cards inside a shelf row. */
    mediaCardGap: 12,
  },
  tablet: {
    screenPaddingHorizontal: 24,
    shelfGridColumns: 4,
    mediaCardWidth: 140,
    mediaCardPosterHeight: 210,
    wideCardWidth: 288,
    wideCardHeight: 162,
    mediaCardGap: 16,
  },
  desktop: {
    screenPaddingHorizontal: 32,
    shelfGridColumns: 6,
    mediaCardWidth: 170,
    mediaCardPosterHeight: 255,
    wideCardWidth: 340,
    wideCardHeight: 191,
    mediaCardGap: 20,
  },
} as const;
export type ResponsiveValues = (typeof responsive)[Breakpoint];

/** Resolves a raw window width (dp) into one of the three breakpoints. */
export function breakpointForWidth(width: number): Breakpoint {
  if (width >= breakpoints.desktop) return "desktop";
  if (width >= breakpoints.tablet) return "tablet";
  return "phone";
}

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
 * Opacity values for interactive state + alpha composition. Use
 * `pressed` in `Pressable` style callbacks, `disabled` for inactive
 * states, `overlay` / `scrim` for dimming content behind modals,
 * and the `alphaN` scale for glass-morphism over video or images
 * (compose with `withAlpha(colors.white, opacity.alpha15)`).
 */
export const opacity = {
  pressed: 0.75,
  disabled: 0.5,
  overlay: 0.4,
  // Alpha composition scale — for glass surfaces, scrims, translucent
  // chrome over dynamic content (player controls over video).
  alpha10: 0.1,
  alpha15: 0.15,
  alpha20: 0.2,
  alpha45: 0.45,
  alpha50: 0.5,
} as const;
export type OpacityToken = keyof typeof opacity;

/**
 * Compose a color with an alpha value. Works for any CSS-style
 * hex color (`#rrggbb`) and produces an `rgba(…)` string React
 * Native understands. Used to build glass-morphism backgrounds
 * from theme neutrals + an opacity token.
 */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

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

  // Neutrals — use with `withAlpha` for glass / scrim compositions.
  // Reach for these when a translucent surface must read over
  // dynamic content (video, images) regardless of the theme.
  white: "#ffffff",
  black: "#000000",
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
