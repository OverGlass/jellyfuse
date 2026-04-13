import type { MediaServer, SeasonInfo } from "@jellyfuse/models";
import {
  initRequestFlow,
  pickInitialProfile,
  requestFlowReducer,
  type RequestFlowState,
} from "./request-flow";

// `describe` / `it` / `expect` come from Jest globals (jest-expo
// preset) — no `from "vitest"` import needed. The reducer is pure
// TS so it runs cleanly inside Jest's CommonJS environment without
// any mocking.

const seasonsFixture: SeasonInfo[] = [
  { seasonNumber: 1, name: "Season 1", availability: "available" },
  { seasonNumber: 2, name: "Season 2", availability: "missing" },
  { seasonNumber: 3, name: "Season 3", availability: "missing" },
  { seasonNumber: 4, name: "Season 4", availability: "requested" },
];

const movieInit: RequestFlowState = initRequestFlow({ mediaType: "movie", hasSeasonStep: false });
const tvInit: RequestFlowState = initRequestFlow({ mediaType: "tv", hasSeasonStep: true });

describe("initRequestFlow", () => {
  it("starts a movie flow at the quality step", () => {
    expect(movieInit.step).toBe("quality");
    expect(movieInit.mediaType).toBe("movie");
    expect(movieInit.selectedSeasons).toEqual([]);
  });

  it("starts a TV flow with seasons at the seasons step", () => {
    expect(tvInit.step).toBe("seasons");
    expect(tvInit.mediaType).toBe("tv");
  });

  it("starts a TV flow without seasons at the quality step (matches Rust)", () => {
    const tvNoSeasons = initRequestFlow({ mediaType: "tv", hasSeasonStep: false });
    expect(tvNoSeasons.step).toBe("quality");
  });
});

describe("requestFlowReducer", () => {
  it("toggles a season into and out of selectedSeasons", () => {
    const after = requestFlowReducer(tvInit, { type: "TOGGLE_SEASON", seasonNumber: 2 });
    expect(after.selectedSeasons).toEqual([2]);
    const back = requestFlowReducer(after, { type: "TOGGLE_SEASON", seasonNumber: 2 });
    expect(back.selectedSeasons).toEqual([]);
  });

  it("keeps selectedSeasons sorted", () => {
    let s = tvInit;
    s = requestFlowReducer(s, { type: "TOGGLE_SEASON", seasonNumber: 3 });
    s = requestFlowReducer(s, { type: "TOGGLE_SEASON", seasonNumber: 2 });
    expect(s.selectedSeasons).toEqual([2, 3]);
  });

  it("SELECT_ALL_SEASONS picks only missing seasons", () => {
    const after = requestFlowReducer(tvInit, {
      type: "SELECT_ALL_SEASONS",
      seasons: seasonsFixture,
    });
    expect(after.selectedSeasons).toEqual([2, 3]);
  });

  it("CLEAR_SEASONS empties the selection", () => {
    const seeded = { ...tvInit, selectedSeasons: [2, 3] };
    expect(requestFlowReducer(seeded, { type: "CLEAR_SEASONS" }).selectedSeasons).toEqual([]);
  });

  it("GO_TO_QUALITY → quality, GO_BACK_TO_SEASONS → seasons", () => {
    const onQuality = requestFlowReducer(tvInit, { type: "GO_TO_QUALITY" });
    expect(onQuality.step).toBe("quality");
    const back = requestFlowReducer(onQuality, { type: "GO_BACK_TO_SEASONS" });
    expect(back.step).toBe("seasons");
  });

  it("SELECT_PROFILE stores the (serverId, profileId) tuple", () => {
    const after = requestFlowReducer(movieInit, {
      type: "SELECT_PROFILE",
      serverId: 1,
      profileId: 4,
    });
    expect(after.selectedProfile).toEqual({ serverId: 1, profileId: 4 });
  });

  it("SUBMIT → submitting, SUBMIT_SUCCESS → done", () => {
    const submitting = requestFlowReducer(movieInit, { type: "SUBMIT" });
    expect(submitting.step).toBe("submitting");
    const done = requestFlowReducer(submitting, { type: "SUBMIT_SUCCESS" });
    expect(done.step).toBe("done");
  });

  it("SUBMIT_ERROR → error, RETRY → quality with error cleared", () => {
    const errored = requestFlowReducer(movieInit, {
      type: "SUBMIT_ERROR",
      message: "HTTP 500",
    });
    expect(errored.step).toBe("error");
    expect(errored.errorMessage).toBe("HTTP 500");
    const retried = requestFlowReducer(errored, { type: "RETRY" });
    expect(retried.step).toBe("quality");
    expect(retried.errorMessage).toBeUndefined();
  });
});

describe("pickInitialProfile", () => {
  const sonarr: MediaServer = {
    id: 1,
    name: "sonarr",
    profiles: [
      { id: 4, name: "HD-1080p" },
      { id: 7, name: "Ultra-HD" },
    ],
    defaultProfileId: 7,
  };

  it("returns the server's defaultProfileId when present", () => {
    expect(pickInitialProfile([sonarr])).toEqual({ serverId: 1, profileId: 7 });
  });

  it("falls back to the first profile when defaultProfileId is missing", () => {
    const noDefault: MediaServer = { ...sonarr, defaultProfileId: undefined };
    expect(pickInitialProfile([noDefault])).toEqual({ serverId: 1, profileId: 4 });
  });

  it("returns undefined when no servers / no profiles", () => {
    expect(pickInitialProfile([])).toBeUndefined();
    expect(
      pickInitialProfile([{ id: 1, name: "x", profiles: [], defaultProfileId: undefined }]),
    ).toBeUndefined();
  });
});
