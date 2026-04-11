import { clearAllScrollStates, clearScrollState, readScrollState, writeScrollState } from "./store";

describe("nav-state store", () => {
  afterEach(() => {
    clearAllScrollStates();
  });

  it("round-trips writeScrollState → readScrollState", () => {
    writeScrollState("/home", { offset: 420 });
    expect(readScrollState("/home")).toEqual({ offset: 420 });
  });

  it("returns undefined when nothing saved for a route", () => {
    expect(readScrollState("/not-yet")).toBeUndefined();
  });

  it("isolates routes from each other", () => {
    writeScrollState("/home", { offset: 100 });
    writeScrollState("/shelf/latest-movies", { offset: 500 });
    expect(readScrollState("/home")?.offset).toBe(100);
    expect(readScrollState("/shelf/latest-movies")?.offset).toBe(500);
  });

  it("clearScrollState drops just one route", () => {
    writeScrollState("/home", { offset: 100 });
    writeScrollState("/shelf/latest-movies", { offset: 500 });
    clearScrollState("/home");
    expect(readScrollState("/home")).toBeUndefined();
    expect(readScrollState("/shelf/latest-movies")?.offset).toBe(500);
  });

  it("clearAllScrollStates drops everything under the nav-state prefix", () => {
    writeScrollState("/home", { offset: 100 });
    writeScrollState("/shelf/latest-movies", { offset: 500 });
    writeScrollState("/detail/series/abc", { offset: 200 });
    clearAllScrollStates();
    expect(readScrollState("/home")).toBeUndefined();
    expect(readScrollState("/shelf/latest-movies")).toBeUndefined();
    expect(readScrollState("/detail/series/abc")).toBeUndefined();
  });

  it("tolerates corrupted JSON gracefully", () => {
    // Direct write via the underlying MMKV would corrupt — simulate
    // by writing a non-number offset and checking read returns undefined.
    writeScrollState("/broken", { offset: Number.NaN });
    // Number.NaN serialises to "null" in JSON, so the parsed value is
    // not a number and read returns undefined.
    expect(readScrollState("/broken")).toBeUndefined();
  });
});
