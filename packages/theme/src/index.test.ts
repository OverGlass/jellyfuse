import { describe, expect, it } from "vitest"
import { colors, fontSize, fontWeight, spacing } from "./index.js"

describe("@jellyfuse/theme", () => {
  it("spacing scale is monotonically increasing", () => {
    const values = Object.values(spacing)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it("fontSize scale is monotonically increasing", () => {
    const values = Object.values(fontSize)
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it("fontWeight values are valid React Native weight strings", () => {
    for (const weight of Object.values(fontWeight)) {
      expect(weight).toMatch(/^[1-9]00$/)
    }
  })

  it("color tokens are hex strings", () => {
    for (const [name, value] of Object.entries(colors)) {
      expect(value, `${name} must be a hex color`).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})
