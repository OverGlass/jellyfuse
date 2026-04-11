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
 * Phase 0b ships a single dark-first palette. A full Jellyfin-tinted palette
 * with light/dark variants lands in Phase 2 when the real components arrive.
 */
export const colors = {
  /** Page / app background. */
  background: "#000000",
  /** Elevated surface (cards, sheets). */
  surface: "#111111",
  /** Primary text. */
  textPrimary: "#ffffff",
  /** Secondary text (subtitles, metadata). */
  textSecondary: "#9aa0a6",
  /** Muted text (captions, disabled). */
  textMuted: "#5f6368",
  /** Accent (brand). Placeholder until Phase 2. */
  accent: "#00a4dc",
} as const;
export type ColorToken = keyof typeof colors;
