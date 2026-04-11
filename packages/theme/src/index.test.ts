import { describe, expect, it } from "vitest";
import {
  breakpointForWidth,
  breakpoints,
  colors,
  duration,
  fontSize,
  fontWeight,
  layout,
  opacity,
  profileColorFor,
  profilePalette,
  radius,
  responsive,
  spacing,
} from "./index";

describe("@jellyfuse/theme", () => {
  it("spacing scale is monotonically increasing", () => {
    const values = Object.values(spacing);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("fontSize scale is monotonically increasing", () => {
    const values = Object.values(fontSize);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("fontWeight values are valid React Native weight strings", () => {
    for (const weight of Object.values(fontWeight)) {
      expect(weight).toMatch(/^[1-9]00$/);
    }
  });

  it("layout tokens are positive numbers", () => {
    for (const [name, value] of Object.entries(layout)) {
      expect(typeof value, `${name} must be a number`).toBe("number");
      expect(value, `${name} must be positive`).toBeGreaterThan(0);
    }
  });

  it("radius scale is monotonically non-decreasing", () => {
    const ordered = [radius.none, radius.sm, radius.md, radius.lg, radius.full];
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });

  it("opacity tokens fall within (0, 1]", () => {
    for (const [name, value] of Object.entries(opacity)) {
      expect(value, `${name} must be > 0`).toBeGreaterThan(0);
      expect(value, `${name} must be <= 1`).toBeLessThanOrEqual(1);
    }
  });

  it("duration scale is monotonically increasing", () => {
    const ordered = [duration.fast, duration.normal, duration.slow];
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });

  describe("responsive breakpoints", () => {
    it("breakpoints are monotonically non-decreasing", () => {
      const ordered = [breakpoints.phone, breakpoints.tablet, breakpoints.desktop];
      expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
    });

    it("breakpointForWidth maps widths correctly", () => {
      expect(breakpointForWidth(375)).toBe("phone"); // iPhone 13 portrait
      expect(breakpointForWidth(599)).toBe("phone"); // just under tablet
      expect(breakpointForWidth(600)).toBe("tablet"); // boundary
      expect(breakpointForWidth(820)).toBe("tablet"); // iPad portrait
      expect(breakpointForWidth(1023)).toBe("tablet"); // just under desktop
      expect(breakpointForWidth(1024)).toBe("desktop"); // boundary
      expect(breakpointForWidth(1366)).toBe("desktop"); // iPad landscape / Catalyst
    });

    it("responsive values are defined for every breakpoint", () => {
      for (const bp of ["phone", "tablet", "desktop"] as const) {
        const values = responsive[bp];
        expect(values.screenPaddingHorizontal).toBeGreaterThan(0);
        expect(values.shelfGridColumns).toBeGreaterThan(0);
        expect(values.mediaCardWidth).toBeGreaterThan(0);
        expect(values.mediaCardPosterHeight).toBeGreaterThan(0);
        expect(values.wideCardWidth).toBeGreaterThan(0);
        expect(values.wideCardHeight).toBeGreaterThan(0);
        expect(values.mediaCardGap).toBeGreaterThan(0);
      }
    });

    it("card width grows from phone to desktop", () => {
      expect(responsive.phone.mediaCardWidth).toBeLessThan(responsive.tablet.mediaCardWidth);
      expect(responsive.tablet.mediaCardWidth).toBeLessThan(responsive.desktop.mediaCardWidth);
    });

    it("wide card keeps a ~16:9 aspect ratio at every breakpoint", () => {
      for (const bp of ["phone", "tablet", "desktop"] as const) {
        const { wideCardWidth, wideCardHeight } = responsive[bp];
        const ratio = wideCardWidth / wideCardHeight;
        expect(ratio).toBeGreaterThanOrEqual(1.7);
        expect(ratio).toBeLessThanOrEqual(1.82);
      }
    });

    it("poster card keeps a ~2:3 aspect ratio at every breakpoint", () => {
      for (const bp of ["phone", "tablet", "desktop"] as const) {
        const { mediaCardWidth, mediaCardPosterHeight } = responsive[bp];
        const ratio = mediaCardPosterHeight / mediaCardWidth;
        expect(ratio).toBeGreaterThanOrEqual(1.48);
        expect(ratio).toBeLessThanOrEqual(1.52);
      }
    });
  });

  it("color tokens are hex strings", () => {
    for (const [name, value] of Object.entries(colors)) {
      expect(value, `${name} must be a hex color`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("profile palette entries are hex strings", () => {
    for (const entry of profilePalette) {
      expect(entry).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(profilePalette.length).toBeGreaterThan(0);
  });

  it("profileColorFor is deterministic", () => {
    const a = profileColorFor("user-xyz");
    const b = profileColorFor("user-xyz");
    expect(a).toBe(b);
    expect(profilePalette).toContain(a);
  });

  it("profileColorFor distributes different seeds across the palette", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      seen.add(profileColorFor(`user-${i}`));
    }
    // With 64 seeds across 8 colors we should hit at least half the
    // palette — otherwise the hash is effectively constant.
    expect(seen.size).toBeGreaterThanOrEqual(profilePalette.length / 2);
  });
});
