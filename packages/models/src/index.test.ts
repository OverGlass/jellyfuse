import { describe, expect, it } from "vitest";
import { MODELS_PACKAGE_VERSION } from "./index";

describe("@jellyfuse/models", () => {
  it("exports a package version marker", () => {
    expect(MODELS_PACKAGE_VERSION).toBe("0.0.0");
  });
});
