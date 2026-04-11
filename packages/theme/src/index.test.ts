import { describe, expect, it } from "vitest";
import {
  colors,
  duration,
  fontSize,
  fontWeight,
  layout,
  opacity,
  profileColorFor,
  profilePalette,
  radius,
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
