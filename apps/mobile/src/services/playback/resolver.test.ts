import { describe, expect, it } from "vitest";
import type { AudioStream, PlaybackInfo, SubtitleTrack } from "@jellyfuse/models";
import { pickAudioStream, pickSubtitleTrack, resolvePlayback } from "./resolver";

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
