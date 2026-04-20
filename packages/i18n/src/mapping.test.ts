import { describe, expect, it } from "vitest";
import { bcp47ToIso639_2, resolveLocale } from "./mapping";

describe("bcp47ToIso639_2", () => {
  it("maps primary subtag regardless of region/script", () => {
    expect(bcp47ToIso639_2("fr-FR")).toBe("fra");
    expect(bcp47ToIso639_2("fr_CA")).toBe("fra");
    expect(bcp47ToIso639_2("FR")).toBe("fra");
  });

  it("returns eng for unknown/empty codes", () => {
    expect(bcp47ToIso639_2("zz")).toBe("eng");
    expect(bcp47ToIso639_2(null)).toBe("eng");
    expect(bcp47ToIso639_2(undefined)).toBe("eng");
    expect(bcp47ToIso639_2("")).toBe("eng");
  });

  it("covers the shipped catalog languages", () => {
    expect(bcp47ToIso639_2("en-US")).toBe("eng");
    expect(bcp47ToIso639_2("de-DE")).toBe("deu");
    expect(bcp47ToIso639_2("ja-JP")).toBe("jpn");
    expect(bcp47ToIso639_2("pt-BR")).toBe("por");
  });
});

describe("resolveLocale", () => {
  it("resolves to a supported catalog or en", () => {
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("fr-FR")).toBe("fr");
    expect(resolveLocale("fr_CA")).toBe("fr");
    expect(resolveLocale("zz-ZZ")).toBe("en");
    expect(resolveLocale(null)).toBe("en");
  });
});
