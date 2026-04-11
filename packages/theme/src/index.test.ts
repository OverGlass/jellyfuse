import { describe, expect, it } from "vitest"
import { spacing } from "./index.js"

describe("@jellyfuse/theme", () => {
  it("exposes monotonically increasing spacing scale", () => {
    const values = Object.values(spacing)
    const sorted = [...values].sort((a, b) => a - b)
    expect(values).toEqual(sorted)
  })
})
