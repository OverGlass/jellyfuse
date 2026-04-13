import { describe, expect, it, vi } from "vitest";
import {
  fetchPlaybackInfo,
  PlaybackInfoHttpError,
  PlaybackInfoParseError,
  type PlaybackInfoFetchArgs,
} from "./playback";

const baseArgs: PlaybackInfoFetchArgs = {
  baseUrl: "https://jellyfin.example.com",
  userId: "user-xyz",
  token: "test-token-123",
  itemId: "item-abc",
};

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures — simulate Jellyfin responses
// ──────────────────────────────────────────────────────────────────────────────

const directPlayResponse = {
  PlaySessionId: "session-dp-1",
  MediaSources: [
    {
      Id: "source-dp-1",
      RunTimeTicks: 81_600_000_000, // 136 min
      SupportsDirectPlay: true,
      SupportsDirectStream: true,
      TranscodingUrl: "/Videos/item-abc/main.m3u8?...",
      Container: "mkv",
      MediaStreams: [
        {
          Type: "Video",
          Index: 0,
          Codec: "h264",
          Width: 1920,
          Height: 1080,
        },
        {
          Type: "Audio",
          Index: 1,
          Codec: "aac",
          Language: "eng",
          DisplayTitle: "English - AAC 5.1",
          Channels: 6,
          IsDefault: true,
        },
        {
          Type: "Audio",
          Index: 2,
          Codec: "ac3",
          Language: "fra",
          DisplayTitle: "French - AC3 5.1",
          Channels: 6,
          IsDefault: false,
        },
        {
          Type: "Subtitle",
          Index: 3,
          Codec: "srt",
          Language: "eng",
          DisplayTitle: "English",
          IsDefault: true,
          IsForced: false,
          DeliveryUrl: "/Videos/item-abc/subtitles/3/0/Stream.srt",
        },
        {
          Type: "Subtitle",
          Index: 4,
          Codec: "srt",
          Language: "fra",
          DisplayTitle: "French",
          IsDefault: false,
          IsForced: false,
          DeliveryUrl: "/Videos/item-abc/subtitles/4/0/Stream.srt",
        },
        {
          Type: "Subtitle",
          Index: 5,
          Codec: "pgs",
          Language: "eng",
          DisplayTitle: "English (Forced)",
          IsDefault: false,
          IsForced: true,
        },
      ],
      // Chapters live on the item details endpoint, not PlaybackInfo
    },
  ],
};

const directStreamResponse = {
  PlaySessionId: "session-ds-1",
  MediaSources: [
    {
      Id: "source-ds-1",
      RunTimeTicks: 72_000_000_000,
      SupportsDirectPlay: false,
      SupportsDirectStream: true,
      Container: "mp4",
      MediaStreams: [
        { Type: "Video", Index: 0, Codec: "h264" },
        {
          Type: "Audio",
          Index: 1,
          Codec: "aac",
          Language: "eng",
          DisplayTitle: "English - AAC Stereo",
          Channels: 2,
          IsDefault: true,
        },
      ],
    },
  ],
};

const transcodeResponse = {
  PlaySessionId: "session-tc-1",
  MediaSources: [
    {
      Id: "source-tc-1",
      RunTimeTicks: 54_000_000_000,
      SupportsDirectPlay: false,
      SupportsDirectStream: false,
      TranscodingUrl:
        "/Videos/item-abc/main.m3u8?PlaySessionId=session-tc-1&VideoCodec=h264&AudioCodec=aac",
      Container: "mkv",
      MediaStreams: [
        { Type: "Video", Index: 0, Codec: "hevc" },
        {
          Type: "Audio",
          Index: 1,
          Codec: "dts",
          Language: "eng",
          DisplayTitle: "English - DTS-HD MA 7.1",
          Channels: 8,
          IsDefault: true,
        },
      ],
    },
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

// Mock item details response with chapters (chapters live here, not in PlaybackInfo)
const itemDetailWithChapters = {
  Id: "item-abc",
  Chapters: [
    { StartPositionTicks: 0, Name: "Chapter 1" },
    { StartPositionTicks: 30_000_000_000, Name: "Chapter 2" },
  ],
};

describe("fetchPlaybackInfo", () => {
  /**
   * Fake fetcher that returns the playback response for POST /PlaybackInfo
   * and the item detail (with chapters) for GET /Users/.../Items/.
   */
  function fakeFetcher(playbackBody: unknown, itemBody: unknown = itemDetailWithChapters) {
    return vi.fn().mockImplementation((url: string) => {
      if (url.includes("/PlaybackInfo")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => playbackBody });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => itemBody });
    });
  }

  it("parses DirectPlay response", async () => {
    const info = await fetchPlaybackInfo(baseArgs, fakeFetcher(directPlayResponse));

    expect(info.method).toBe("DirectPlay");
    expect(info.mediaSourceId).toBe("source-dp-1");
    expect(info.playSessionId).toBe("session-dp-1");
    expect(info.streamUrl).toContain("/Videos/item-abc/stream?");
    expect(info.streamUrl).toContain("Static=true");
    expect(info.streamUrl).toContain("MediaSourceId=source-dp-1");
    expect(info.durationTicks).toBe(81_600_000_000);
  });

  it("parses audio streams", async () => {
    const info = await fetchPlaybackInfo(baseArgs, fakeFetcher(directPlayResponse));

    expect(info.audioStreams).toHaveLength(2);
    expect(info.audioStreams[0]).toEqual({
      index: 1,
      language: "eng",
      displayTitle: "English - AAC 5.1",
      codec: "aac",
      channels: 6,
      isDefault: true,
    });
    expect(info.audioStreams[1]!.language).toBe("fra");
  });

  it("parses subtitle tracks with delivery URLs", async () => {
    const info = await fetchPlaybackInfo(baseArgs, fakeFetcher(directPlayResponse));

    expect(info.subtitles).toHaveLength(3);
    expect(info.subtitles[0]!.deliveryUrl).toBe(
      "https://jellyfin.example.com/Videos/item-abc/subtitles/3/0/Stream.srt",
    );
    expect(info.subtitles[2]!.isForced).toBe(true);
    expect(info.subtitles[2]!.deliveryUrl).toBeUndefined(); // pgs = embedded
  });

  it("parses chapters", async () => {
    const info = await fetchPlaybackInfo(baseArgs, fakeFetcher(directPlayResponse));

    expect(info.chapters).toHaveLength(2);
    expect(info.chapters[0]!.name).toBe("Chapter 1");
    expect(info.chapters[1]!.startPositionTicks).toBe(30_000_000_000);
  });

  it("picks DirectStream when DirectPlay not supported", async () => {
    const info = await fetchPlaybackInfo(baseArgs, fakeFetcher(directStreamResponse));

    expect(info.method).toBe("DirectStream");
    expect(info.streamUrl).toContain("/Videos/item-abc/stream.mp4?");
    expect(info.streamUrl).toContain("Static=true");
  });

  it("picks Transcode when neither DirectPlay nor DirectStream", async () => {
    const info = await fetchPlaybackInfo(baseArgs, fakeFetcher(transcodeResponse));

    expect(info.method).toBe("Transcode");
    expect(info.streamUrl).toContain("/Videos/item-abc/main.m3u8?");
  });

  it("throws PlaybackInfoHttpError on non-OK response", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/PlaybackInfo")) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    });
    await expect(fetchPlaybackInfo(baseArgs, fetcher)).rejects.toThrow(PlaybackInfoHttpError);
  });

  it("throws PlaybackInfoParseError on empty MediaSources", async () => {
    const fetcher = fakeFetcher({ MediaSources: [] });
    await expect(fetchPlaybackInfo(baseArgs, fetcher)).rejects.toThrow(PlaybackInfoParseError);
  });

  it("sends POST with DeviceProfile body", async () => {
    const fetcher = fakeFetcher(directPlayResponse);
    await fetchPlaybackInfo(baseArgs, fetcher);

    // 2 calls: POST /PlaybackInfo + GET /Users/.../Items/...
    expect(fetcher).toHaveBeenCalledTimes(2);
    const playbackCall = fetcher.mock.calls.find((c) => String(c[0]).includes("/PlaybackInfo"))!;
    const [url, init] = playbackCall;
    expect(url).toContain("/Items/item-abc/PlaybackInfo");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.DeviceProfile.DirectPlayProfiles).toBeDefined();
    expect(body.EnableDirectPlay).toBe(true);
  });
});
