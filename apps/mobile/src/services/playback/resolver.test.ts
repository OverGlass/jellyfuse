import { describe, expect, it } from "vitest";
import type { AudioStream, PlaybackInfo, SubtitleTrack } from "@jellyfuse/models";
import {
  computeSubtitleSid,
  pickAudioStream,
  pickSubtitleTrack,
  resolvePlayback,
  subtitleMpvId,
} from "./resolver";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeAudio(overrides: Partial<AudioStream> & { index: number }): AudioStream {
  return {
    language: undefined,
    displayTitle: "Audio",
    codec: "aac",
    channels: 2,
    isDefault: false,
    ...overrides,
  };
}

function makeSub(overrides: Partial<SubtitleTrack> & { index: number }): SubtitleTrack {
  return {
    language: undefined,
    displayTitle: "Subtitle",
    codec: "srt",
    isDefault: false,
    isForced: false,
    deliveryUrl: undefined,
    ...overrides,
  };
}

const basePlaybackInfo: PlaybackInfo = {
  mediaSourceId: "src-1",
  playSessionId: "sess-1",
  method: "DirectPlay",
  streamUrl: "https://jf.test/Videos/item/stream?Static=true",
  audioStreams: [
    makeAudio({ index: 1, language: "eng", isDefault: true, displayTitle: "English - AAC 5.1" }),
    makeAudio({ index: 2, language: "fra", displayTitle: "French - AC3 5.1" }),
    makeAudio({ index: 3, language: "jpn", displayTitle: "Japanese - AAC Stereo" }),
  ],
  subtitles: [
    makeSub({
      index: 4,
      language: "eng",
      isDefault: true,
      displayTitle: "English",
      deliveryUrl: "https://jf.test/sub/4",
    }),
    makeSub({
      index: 5,
      language: "fra",
      displayTitle: "French",
      deliveryUrl: "https://jf.test/sub/5",
    }),
    makeSub({ index: 6, language: "eng", isForced: true, displayTitle: "English (Forced)" }),
  ],
  durationTicks: 72_000_000_000,
  trickplay: undefined,
  chapters: [
    { startPositionTicks: 0, name: "Opening" },
    { startPositionTicks: 30_000_000_000, name: "Main" },
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// pickAudioStream
// ──────────────────────────────────────────────────────────────────────────────

describe("pickAudioStream", () => {
  it("picks stream matching preferred language", () => {
    expect(pickAudioStream(basePlaybackInfo.audioStreams, "fra")).toBe(2);
  });

  it("prefers default among language matches", () => {
    const streams = [
      makeAudio({ index: 1, language: "eng", isDefault: false }),
      makeAudio({ index: 2, language: "eng", isDefault: true }),
    ];
    expect(pickAudioStream(streams, "eng")).toBe(2);
  });

  it("falls back to default stream when no language match", () => {
    expect(pickAudioStream(basePlaybackInfo.audioStreams, "kor")).toBe(1); // eng is default
  });

  it("falls back to first stream when no default and no language match", () => {
    const streams = [
      makeAudio({ index: 5, language: "deu" }),
      makeAudio({ index: 6, language: "spa" }),
    ];
    expect(pickAudioStream(streams, "kor")).toBe(5);
  });

  it("returns undefined for empty streams", () => {
    expect(pickAudioStream([], "eng")).toBeUndefined();
  });

  it("is case-insensitive for language matching", () => {
    const streams = [makeAudio({ index: 1, language: "ENG", isDefault: true })];
    expect(pickAudioStream(streams, "eng")).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// pickSubtitleTrack
// ──────────────────────────────────────────────────────────────────────────────

describe("pickSubtitleTrack", () => {
  it("returns no subtitle when mode is None", () => {
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "None", "eng", "eng");
    expect(result.index).toBeUndefined();
    expect(result.deliveryUrl).toBeUndefined();
  });

  it("picks forced track when mode is OnlyForced", () => {
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "OnlyForced", "eng", "eng");
    expect(result.index).toBe(6); // English (Forced)
    expect(result.deliveryUrl).toBeUndefined(); // embedded pgs
  });

  it("returns no subtitle when OnlyForced but none are forced", () => {
    const tracks = [makeSub({ index: 3, isForced: false }), makeSub({ index: 4, isForced: false })];
    const result = pickSubtitleTrack(tracks, "OnlyForced", "eng", "eng");
    expect(result.index).toBeUndefined();
  });

  it("picks default track when mode is Always", () => {
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "Always", "eng", "eng");
    expect(result.index).toBe(4); // English (default)
    expect(result.deliveryUrl).toBe("https://jf.test/sub/4");
  });

  it("picks default track when mode is Default", () => {
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "Default", "eng", "eng");
    expect(result.index).toBe(4);
  });

  it("Default mode picks preferred-language track even when another track is isDefault", () => {
    // User prefers French subs — French track exists but isn't the server default.
    // Expect the French track over the English default.
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "Default", "eng", "fra");
    expect(result.index).toBe(5); // French
    expect(result.deliveryUrl).toBe("https://jf.test/sub/5");
  });

  it("Always mode picks preferred-language track over the default track", () => {
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "Always", "eng", "fra");
    expect(result.index).toBe(5);
  });

  it("Default mode falls back to default when preferred language absent", () => {
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "Default", "eng", "kor");
    expect(result.index).toBe(4); // English default
  });

  it("Default mode with empty preferred language picks default", () => {
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "Default", "eng", "");
    expect(result.index).toBe(4);
  });

  it("picks first track when Always and no default", () => {
    const tracks = [
      makeSub({ index: 10, language: "spa" }),
      makeSub({ index: 11, language: "ita" }),
    ];
    const result = pickSubtitleTrack(tracks, "Always", "eng", "eng");
    expect(result.index).toBe(10);
  });

  it("returns no subtitle when Always but no tracks", () => {
    const result = pickSubtitleTrack([], "Always", "eng", "eng");
    expect(result.index).toBeUndefined();
  });

  it("prefers default among forced tracks in OnlyForced mode", () => {
    const tracks = [
      makeSub({ index: 10, isForced: true, isDefault: false }),
      makeSub({ index: 11, isForced: true, isDefault: true }),
    ];
    const result = pickSubtitleTrack(tracks, "OnlyForced", "eng", "eng");
    expect(result.index).toBe(11);
  });

  it("Smart picks language-matched subtitle when audio differs", () => {
    // Audio is Japanese, user prefers English subs → should pick the
    // English sub track (default = index 4).
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "Smart", "jpn", "eng");
    expect(result.index).toBe(4);
  });

  it("Smart returns none when audio already matches preferred subtitle language", () => {
    // Audio is English, user prefers English subs → no foreign audio
    // detected, so no subtitle.
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "Smart", "eng", "eng");
    expect(result.index).toBeUndefined();
  });

  it("Smart falls back to default when no language match", () => {
    // Audio is Japanese, preferred sub is Spanish (not in tracks) — still
    // picks something since audio is foreign.
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "Smart", "jpn", "spa");
    expect(result.index).toBe(4); // default English
  });

  it("Smart returns none when no preferred subtitle language set", () => {
    const result = pickSubtitleTrack(basePlaybackInfo.subtitles, "Smart", "jpn", "");
    expect(result.index).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// computeSubtitleSid / subtitleMpvId — group-aware sid mapping
// ──────────────────────────────────────────────────────────────────────────────

describe("computeSubtitleSid", () => {
  const embeddedEng = makeSub({ index: 3, language: "eng" });
  const embeddedEngForced = makeSub({ index: 4, language: "eng", isForced: true });
  const externalFra = makeSub({ index: 5, language: "fra", deliveryUrl: "https://ex/fra" });
  const externalSpa = makeSub({ index: 6, language: "spa", deliveryUrl: "https://ex/spa" });

  it("embedded tracks get sequential sids starting at 1", () => {
    const tracks = [embeddedEng, embeddedEngForced];
    expect(computeSubtitleSid(tracks, embeddedEng)).toBe(1);
    expect(computeSubtitleSid(tracks, embeddedEngForced)).toBe(2);
  });

  it("externals are appended after all embedded in sid space", () => {
    const tracks = [embeddedEng, embeddedEngForced, externalFra, externalSpa];
    expect(computeSubtitleSid(tracks, externalFra)).toBe(3); // 2 embedded + 1
    expect(computeSubtitleSid(tracks, externalSpa)).toBe(4);
  });

  it("external sid is stable even when Jellyfin interleaves the list", () => {
    // Jellyfin lists in order: embedded, external, embedded-forced
    const tracks = [embeddedEng, externalFra, embeddedEngForced];
    // mpv sees 2 embedded + 1 external → sid 1, 2 for embedded, 3 for external
    expect(computeSubtitleSid(tracks, embeddedEng)).toBe(1);
    expect(computeSubtitleSid(tracks, embeddedEngForced)).toBe(2);
    expect(computeSubtitleSid(tracks, externalFra)).toBe(3);
  });
});

describe("subtitleMpvId", () => {
  it("routes a picked Jellyfin index through group-aware sid logic", () => {
    const tracks = [
      makeSub({ index: 3, language: "eng" }),
      makeSub({ index: 5, language: "fra", deliveryUrl: "https://ex/fra" }),
    ];
    expect(subtitleMpvId(tracks, 3)).toBe(1); // embedded English
    expect(subtitleMpvId(tracks, 5)).toBe(2); // 1 embedded + 1 external
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// resolvePlayback (integration)
// ──────────────────────────────────────────────────────────────────────────────

describe("resolvePlayback", () => {
  it("resolves DirectPlay with correct tracks", () => {
    const result = resolvePlayback({
      playbackInfo: basePlaybackInfo,
      settings: {
        preferredAudioLanguage: "eng",
        preferredSubtitleLanguage: "eng",
        subtitleMode: "Always",
      },
    });

    expect(result.playMethod).toBe("DirectPlay");
    expect(result.streamUrl).toBe(basePlaybackInfo.streamUrl);
    expect(result.audioStreamIndex).toBe(1); // eng default
    expect(result.subtitleStreamIndex).toBe(4); // eng default sub
    expect(result.audioMpvTrackId).toBe(1); // English audio is position 0 → mpv aid 1
    // Fixture has 1 embedded sub (idx 6) + 2 externals (idx 4, 5). English
    // default (idx 4) is the first external → mpv sid 1 embedded + 0 + 1 = 2.
    expect(result.subtitleMpvTrackId).toBe(2);
    expect(result.subtitleDeliveryUrl).toBe("https://jf.test/sub/4");
    expect(result.durationSeconds).toBeCloseTo(7200, 0); // 72B ticks = 7200s
    expect(result.chapters).toHaveLength(2);
  });

  it("resolves Transcode with subtitle mode None", () => {
    const info: PlaybackInfo = {
      ...basePlaybackInfo,
      method: "Transcode",
      streamUrl: "https://jf.test/Videos/item/main.m3u8?VideoCodec=h264",
    };

    const result = resolvePlayback({
      playbackInfo: info,
      settings: {
        preferredAudioLanguage: "eng",
        preferredSubtitleLanguage: "eng",
        subtitleMode: "None",
      },
    });

    expect(result.playMethod).toBe("Transcode");
    expect(result.subtitleStreamIndex).toBeUndefined();
    expect(result.subtitleDeliveryUrl).toBeUndefined();
  });

  it("selects French audio when preferred", () => {
    const result = resolvePlayback({
      playbackInfo: basePlaybackInfo,
      settings: {
        preferredAudioLanguage: "fra",
        preferredSubtitleLanguage: "eng",
        subtitleMode: "None",
      },
    });

    expect(result.audioStreamIndex).toBe(2); // French
    expect(result.audioMpvTrackId).toBe(2); // French is position 1 → mpv aid 2
    expect(result.subtitleMpvTrackId).toBeUndefined();
  });

  it("applies preferred subtitle language in Default mode", () => {
    const result = resolvePlayback({
      playbackInfo: basePlaybackInfo,
      settings: {
        preferredAudioLanguage: "eng",
        preferredSubtitleLanguage: "fra",
        subtitleMode: "Default",
      },
    });

    expect(result.subtitleStreamIndex).toBe(5); // French
    // 1 embedded + French is the 2nd external → sid = 1 + 1 + 1 = 3
    expect(result.subtitleMpvTrackId).toBe(3);
    expect(result.subtitleDeliveryUrl).toBe("https://jf.test/sub/5");
  });

  it("passes through intro-skipper segments", () => {
    const segments = {
      introduction: { start: 0, end: 30 },
      recap: undefined,
      credits: { start: 7150, end: 7200 },
    };

    const result = resolvePlayback({
      playbackInfo: basePlaybackInfo,
      settings: {
        preferredAudioLanguage: "eng",
        preferredSubtitleLanguage: "eng",
        subtitleMode: "None",
      },
      introSkipperSegments: segments,
    });

    expect(result.introSkipperSegments?.introduction?.end).toBe(30);
    expect(result.introSkipperSegments?.credits?.start).toBe(7150);
  });

  it("handles playback info with no audio or subtitle streams", () => {
    const info: PlaybackInfo = {
      ...basePlaybackInfo,
      audioStreams: [],
      subtitles: [],
    };

    const result = resolvePlayback({
      playbackInfo: info,
      settings: {
        preferredAudioLanguage: "eng",
        preferredSubtitleLanguage: "eng",
        subtitleMode: "Always",
      },
    });

    expect(result.audioStreamIndex).toBeUndefined();
    expect(result.subtitleStreamIndex).toBeUndefined();
  });

  it("applies Smart subtitle selection via resolver", () => {
    // Pick Japanese audio, Smart mode, user prefers English subs → picks English.
    const result = resolvePlayback({
      playbackInfo: basePlaybackInfo,
      settings: {
        preferredAudioLanguage: "jpn",
        preferredSubtitleLanguage: "eng",
        subtitleMode: "Smart",
      },
    });

    expect(result.audioStreamIndex).toBe(3); // Japanese
    expect(result.subtitleStreamIndex).toBe(4); // English default
  });
});
