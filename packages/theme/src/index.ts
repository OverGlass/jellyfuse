// @jellyfuse/theme — design tokens shared between apps/mobile and apps/web.
// Kept minimal in Phase 0a; real palette, spacing, typography, and radii land
// alongside the first UI components in Phase 2.

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const

export type Spacing = keyof typeof spacing
