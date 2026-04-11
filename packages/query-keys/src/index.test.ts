import { describe, expect, it } from "vitest"
import { STALE_TIMES, queryKeys } from "./index.js"

describe("@jellyfuse/query-keys", () => {
  it("exposes stale times as finite positive numbers", () => {
    for (const [name, ms] of Object.entries(STALE_TIMES)) {
      expect(Number.isFinite(ms), `${name} must be finite`).toBe(true)
      expect(ms, `${name} must be > 0`).toBeGreaterThan(0)
    }
  })

  it("qualityProfiles stale time matches the Rust crate (30 min)", () => {
    expect(STALE_TIMES.qualityProfiles).toBe(30 * 60 * 1000)
  })

  it("home key is scoped by userId so queryClient.clear() is sufficient on user switch", () => {
    expect(queryKeys.home("user-a")).toEqual(["home", "user-a"])
    expect(queryKeys.home("user-b")).toEqual(["home", "user-b"])
  })
})
