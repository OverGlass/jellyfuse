import { describe, expect, it } from "vitest"
import { buildAuthHeader, type AuthContext } from "./index.js"

const base: AuthContext = {
  deviceId: "device-abc",
  token: undefined,
  clientName: "Jellyfuse",
  clientVersion: "0.0.0",
  deviceName: "iPhone 15 Pro",
}

describe("buildAuthHeader", () => {
  it("omits Token when not authenticated", () => {
    const header = buildAuthHeader(base)
    expect(header).toContain('Client="Jellyfuse"')
    expect(header).toContain('Device="iPhone 15 Pro"')
    expect(header).toContain('DeviceId="device-abc"')
    expect(header).toContain('Version="0.0.0"')
    expect(header).not.toContain("Token=")
  })

  it("includes Token when authenticated", () => {
    const header = buildAuthHeader({ ...base, token: "tok-123" })
    expect(header).toContain('Token="tok-123"')
  })

  it("escapes quotes and backslashes in values", () => {
    const header = buildAuthHeader({
      ...base,
      deviceName: 'My "Device" \\ with slashes',
    })
    expect(header).toContain('Device="My \\"Device\\" \\\\ with slashes"')
  })
})
