// Playback info fetcher — ports `get_playback_info` from
// `crates/jf-api/src/jellyfin.rs`. Pure function, takes a FetchLike.

import type {
  AudioStream,
  Chapter,
  IntroSkipperSegments,
  PlayMethod,
  PlaybackInfo,
  SkipSegment,
  SubtitleTrack,
} from "@jellyfuse/models";
import type { FetchLike } from "./system-info";

// ──────────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────────

export class PlaybackInfoHttpError extends Error {
  readonly status: number;
  readonly itemId: string;
  constructor(itemId: string, status: number) {
    super(`PlaybackInfo for '${itemId}' returned HTTP ${status}`);
    this.name = "PlaybackInfoHttpError";
    this.itemId = itemId;
    this.status = status;
  }
}

export class PlaybackInfoParseError extends Error {
  readonly itemId: string;
  constructor(itemId: string, message: string) {
    super(`PlaybackInfo for '${itemId}' returned an unexpected payload: ${message}`);
    this.name = "PlaybackInfoParseError";
    this.itemId = itemId;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Device profile — mirrors Rust `desktop_device_profile()` (jellyfin.rs:1130)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Permissive device profile telling Jellyfin the client supports most
 * containers/codecs natively via mpv. Prefers DirectPlay/DirectStream
 * over Transcode. maxBitrate can override `MaxStreamingBitrate` if
 * the user caps their bandwidth in Settings.
 */
export function buildDeviceProfile(maxBitrate?: number) {
  return {
    MaxStreamingBitrate: maxBitrate ?? 120_000_000,
    DirectPlayProfiles: [
      {
        Type: "Video",
        Container: "mkv,mp4,m4v,mov,avi,ts,wmv,flv,webm",
        VideoCodec: "h264,hevc,vp9,av1,mpeg4,vc1",
        AudioCodec: "aac,mp3,ac3,eac3,dts,truehd,flac,opus,vorbis,pcm",
      },
      {
        Type: "Audio",
        Container: "mp3,aac,flac,ogg,opus,wav",
      },
    ],
    TranscodingProfiles: [
      {
        Container: "ts",
        VideoCodec: "h264",
        AudioCodec: "aac",
        Protocol: "hls",
        Type: "Video",
      },
    ],
    SubtitleProfiles: [
      { Format: "srt", Method: "External" },
      { Format: "vtt", Method: "External" },
      { Format: "ass", Method: "External" },
      { Format: "ssa", Method: "External" },
      { Format: "pgs", Method: "Embed" },
      { Format: "dvbsub", Method: "Embed" },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetcher
// ──────────────────────────────────────────────────────────────────────────────

export interface PlaybackInfoFetchArgs {
  baseUrl: string;
  userId: string;
  token: string;
  itemId: string;
  maxBitrate?: number;
}

/**
 * `POST /Items/{id}/PlaybackInfo` — returns the server's decision on
 * how this item can be played (DirectPlay / DirectStream / Transcode)
 * along with all stream metadata.
 */
export async function fetchPlaybackInfo(
  args: PlaybackInfoFetchArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<PlaybackInfo> {
  const url = buildUrl(args.baseUrl, `/Items/${args.itemId}/PlaybackInfo`, {
    UserId: args.userId,
  });

  const body = JSON.stringify({
    DeviceProfile: buildDeviceProfile(args.maxBitrate),
    EnableDirectPlay: true,
    EnableDirectStream: true,
    EnableTranscoding: true,
    AutoOpenLiveStream: true,
  });

  const res = await fetcherWithInit(fetcher, url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Emby-Authorization": `MediaBrowser Token="${args.token}"`,
    },
    body,
    signal,
  });

  if (!res.ok) {
    throw new PlaybackInfoHttpError(args.itemId, res.status);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return parsePlaybackInfo(args.itemId, args.baseUrl, json, args.token);
}

// ──────────────────────────────────────────────────────────────────────────────
// Response parser — mirrors `parse_playback_info()` (jellyfin.rs:1026)
// ──────────────────────────────────────────────────────────────────────────────

function parsePlaybackInfo(
  itemId: string,
  baseUrl: string,
  json: Record<string, unknown>,
  token?: string,
): PlaybackInfo {
  const sources = json["MediaSources"];
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new PlaybackInfoParseError(itemId, "no MediaSources");
  }
  const src = sources[0] as Record<string, unknown>;

  const mediaSourceId = String(src["Id"] ?? "");
  const playSessionId = String(json["PlaySessionId"] ?? "");
  const durationTicks = Number(src["RunTimeTicks"] ?? 0);
  const supportsDirectPlay = src["SupportsDirectPlay"] === true;
  const supportsDirectStream = src["SupportsDirectStream"] === true;
  const transcodingUrl =
    typeof src["TranscodingUrl"] === "string" ? src["TranscodingUrl"] : undefined;
  const container = typeof src["Container"] === "string" ? src["Container"] : "mkv";

  // Decide play method + URL (jellyfin.rs:1049-1071)
  let method: PlayMethod;
  let streamUrl: string;

  // api_key in the URL is required — mpv fetches the stream directly
  // and can't use HTTP headers for auth (matching Rust jellyfin.rs:1049-1071).
  const authParams: Record<string, string> = {
    Static: "true",
    MediaSourceId: mediaSourceId,
    ...(token ? { api_key: token } : {}),
  };

  if (supportsDirectPlay) {
    method = "DirectPlay";
    streamUrl = buildUrl(baseUrl, `/Videos/${itemId}/stream`, authParams);
  } else if (supportsDirectStream) {
    method = "DirectStream";
    streamUrl = buildUrl(baseUrl, `/Videos/${itemId}/stream.${container}`, authParams);
  } else if (transcodingUrl) {
    method = "Transcode";
    streamUrl = `${trimSlash(baseUrl)}${transcodingUrl}`;
  } else {
    throw new PlaybackInfoParseError(itemId, "no playable source");
  }

  // Parse media streams
  const rawStreams = Array.isArray(src["MediaStreams"])
    ? (src["MediaStreams"] as Record<string, unknown>[])
    : [];

  const audioStreams: AudioStream[] = rawStreams
    .filter((s) => s["Type"] === "Audio")
    .map((s) => ({
      index: Number(s["Index"] ?? 0),
      language: typeof s["Language"] === "string" ? s["Language"] : undefined,
      displayTitle: String(s["DisplayTitle"] ?? "Unknown"),
      codec: String(s["Codec"] ?? "unknown"),
      channels: typeof s["Channels"] === "number" ? s["Channels"] : undefined,
      isDefault: s["IsDefault"] === true,
    }));

  const subtitles: SubtitleTrack[] = rawStreams
    .filter((s) => s["Type"] === "Subtitle")
    .map((s) => ({
      index: Number(s["Index"] ?? 0),
      language: typeof s["Language"] === "string" ? s["Language"] : undefined,
      displayTitle: String(s["DisplayTitle"] ?? "Unknown"),
      codec: typeof s["Codec"] === "string" ? s["Codec"] : undefined,
      isDefault: s["IsDefault"] === true,
      isForced: s["IsForced"] === true,
      deliveryUrl:
        typeof s["DeliveryUrl"] === "string"
          ? `${trimSlash(baseUrl)}${s["DeliveryUrl"]}`
          : undefined,
    }));

  // Parse chapters
  const rawChapters = Array.isArray(src["Chapters"])
    ? (src["Chapters"] as Record<string, unknown>[])
    : [];
  const chapters: Chapter[] = rawChapters.map((c) => ({
    startPositionTicks: Number(c["StartPositionTicks"] ?? 0),
    name: String(c["Name"] ?? ""),
  }));

  return {
    mediaSourceId,
    playSessionId,
    method,
    streamUrl,
    subtitles,
    audioStreams,
    durationTicks,
    trickplay: undefined, // Fetched separately via /Videos/{id}/Trickplay in Phase 3e
    chapters,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Trickplay — `GET /Videos/{id}/Trickplay` metadata
// ──────────────────────────────────────────────────────────────────────────────

export interface TrickplayData {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  thumbnailCount: number;
  interval: number;
  /** Base URL for tile sheets: `{baseUrl}/Videos/{id}/Trickplay/{width}/{index}.jpg` */
  sheetBaseUrl: string;
}

/**
 * Fetch trickplay metadata. Returns the highest-resolution trickplay
 * track available. Returns undefined if trickplay is not generated
 * for this item.
 */
export async function fetchTrickplayInfo(
  args: { baseUrl: string; itemId: string },
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<TrickplayData | undefined> {
  try {
    const url = `${trimSlash(args.baseUrl)}/Videos/${args.itemId}/Trickplay`;
    const res = await fetcher(url, { signal });
    if (!res.ok) return undefined;

    const json = (await res.json()) as Record<string, unknown>;

    // Response shape: { "MediaSourceId": { "320": { Width, Height, ... } } }
    // Pick the first media source, then the highest resolution track.
    const sources = Object.values(json) as Record<string, unknown>[];
    if (sources.length === 0) return undefined;

    const tracks = sources[0] as Record<string, Record<string, unknown>> | undefined;
    if (!tracks) return undefined;

    // Pick highest resolution (largest key number)
    const resolutions = Object.keys(tracks)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => b - a);

    if (resolutions.length === 0) return undefined;

    const bestRes = resolutions[0]!;
    const track = tracks[String(bestRes)]!;

    return {
      width: Number(track["Width"] ?? bestRes),
      height: Number(track["Height"] ?? 0),
      tileWidth: Number(track["TileWidth"] ?? 10),
      tileHeight: Number(track["TileHeight"] ?? 10),
      thumbnailCount: Number(track["ThumbnailCount"] ?? 0),
      interval: Number(track["Interval"] ?? 10000),
      sheetBaseUrl: `${trimSlash(args.baseUrl)}/Videos/${args.itemId}/Trickplay/${bestRes}`,
    };
  } catch {
    return undefined;
  }
}

/**
 * Given a position in seconds, compute which trickplay tile to show.
 * Returns the sheet URL and crop coordinates within the sheet.
 */
export function trickplayTileFor(
  data: TrickplayData,
  positionSeconds: number,
): { sheetUrl: string; cropX: number; cropY: number } {
  const tileIndex = Math.floor((positionSeconds * 1000) / data.interval);
  const clamped = Math.max(0, Math.min(tileIndex, data.thumbnailCount - 1));

  const tilesPerSheet = data.tileWidth * data.tileHeight;
  const sheetIndex = Math.floor(clamped / tilesPerSheet);
  const indexInSheet = clamped % tilesPerSheet;

  const col = indexInSheet % data.tileWidth;
  const row = Math.floor(indexInSheet / data.tileWidth);

  return {
    sheetUrl: `${data.sheetBaseUrl}/${sheetIndex}.jpg`,
    cropX: col * data.width,
    cropY: row * data.height,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Intro-skipper segments — `GET /Items/{id}/Intros` (plugin endpoint)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fetch intro/recap/credits segments from the Jellyfin intro-skipper
 * plugin. Returns undefined if the plugin is not installed or the
 * item has no segments. Never throws — silently returns undefined.
 */
export async function fetchIntroSkipperSegments(
  args: { baseUrl: string; itemId: string },
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<IntroSkipperSegments | undefined> {
  try {
    const url = `${trimSlash(args.baseUrl)}/Episode/${args.itemId}/IntroSkipperSegments`;
    const res = await fetcher(url, { signal });
    if (!res.ok) return undefined;

    const json = (await res.json()) as Record<string, unknown>;
    return parseIntroSkipperSegments(json);
  } catch {
    return undefined;
  }
}

function parseIntroSkipperSegments(
  json: Record<string, unknown>,
): IntroSkipperSegments | undefined {
  function parseSegment(key: string): SkipSegment | undefined {
    const seg = json[key] as Record<string, unknown> | undefined;
    if (!seg) return undefined;
    const start = Number(seg["ShowSkipPromptAt"] ?? seg["Start"] ?? 0);
    const end = Number(seg["HideSkipPromptAt"] ?? seg["End"] ?? 0);
    if (end <= start) return undefined;
    return { start, end };
  }

  const introduction = parseSegment("Introduction");
  const recap = parseSegment("Recap");
  const credits = parseSegment("Credits");

  if (!introduction && !recap && !credits) return undefined;
  return { introduction, recap, credits };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildUrl(baseUrl: string, path: string, params: Record<string, string>): string {
  const base = trimSlash(baseUrl);
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}${path}?${qs}` : `${base}${path}`;
}

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal | undefined;
}

async function fetcherWithInit(
  fetcher: FetchLike,
  url: string,
  init: FetchInit,
): Promise<Awaited<ReturnType<FetchLike>>> {
  const wideFetcher = fetcher as (
    input: string,
    init: FetchInit,
  ) => Promise<Awaited<ReturnType<FetchLike>>>;
  return wideFetcher(url, init);
}
