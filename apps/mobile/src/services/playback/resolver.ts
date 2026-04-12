// Playback resolver — pure function that takes a PlaybackInfo + user
// Settings and returns a ResolvedStream ready for NativeMpv.load().
// Ports the decision tree from `crates/jf-api/src/jellyfin.rs` and
// adds audio/subtitle track selection that the Rust version deferred
// to mpv auto-select.

import type {
  AudioStream,
  IntroSkipperSegments,
  PlaybackInfo,
  ResolvedStream,
  SubtitleMode,
  SubtitleTrack,
} from "@jellyfuse/models";
import { ticksToSeconds } from "@jellyfuse/models";

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export interface ResolverSettings {
  preferredAudioLanguage: string;
  subtitleMode: SubtitleMode;
}

export interface ResolvePlaybackInput {
  playbackInfo: PlaybackInfo;
  settings: ResolverSettings;
  introSkipperSegments?: IntroSkipperSegments;
}

/**
 * Takes a `PlaybackInfo` (from `fetchPlaybackInfo`) + user settings
 * and returns a `ResolvedStream` containing the stream URL, selected
 * tracks, and all metadata the player screen needs.
 *
 * Pure function — no side effects, fully unit-testable.
 */
export function resolvePlayback(input: ResolvePlaybackInput): ResolvedStream {
  const { playbackInfo, settings, introSkipperSegments } = input;

  const audioStreamIndex = pickAudioStream(
    playbackInfo.audioStreams,
    settings.preferredAudioLanguage,
  );
  const { index: subtitleStreamIndex, deliveryUrl: subtitleDeliveryUrl } = pickSubtitleTrack(
    playbackInfo.subtitles,
    settings.subtitleMode,
  );

  return {
    streamUrl: playbackInfo.streamUrl,
    playMethod: playbackInfo.method,
    mediaSourceId: playbackInfo.mediaSourceId,
    playSessionId: playbackInfo.playSessionId,
    audioStreamIndex,
    subtitleStreamIndex,
    subtitleDeliveryUrl,
    audioStreams: playbackInfo.audioStreams,
    subtitleTracks: playbackInfo.subtitles,
    durationSeconds: ticksToSeconds(playbackInfo.durationTicks),
    chapters: playbackInfo.chapters,
    trickplay: playbackInfo.trickplay,
    introSkipperSegments,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Audio track selection
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Pick the best audio stream index based on preferred language.
 *
 * 1. Filter by `preferredAudioLanguage` match.
 * 2. Among matches, prefer `isDefault`.
 * 3. If no language match, fall back to first `isDefault`.
 * 4. If no default, return first stream (index 0).
 * 5. If no streams at all, return undefined (mpv auto-select).
 */
export function pickAudioStream(
  streams: AudioStream[],
  preferredLanguage: string,
): number | undefined {
  if (streams.length === 0) return undefined;

  const langMatches = streams.filter(
    (s) => s.language !== undefined && s.language.toLowerCase() === preferredLanguage.toLowerCase(),
  );

  if (langMatches.length > 0) {
    const defaultMatch = langMatches.find((s) => s.isDefault);
    return (defaultMatch ?? langMatches[0]).index;
  }

  const defaultStream = streams.find((s) => s.isDefault);
  return (defaultStream ?? streams[0]).index;
}

// ──────────────────────────────────────────────────────────────────────────────
// Subtitle track selection
// ──────────────────────────────────────────────────────────────────────────────

interface SubtitlePick {
  index: number | undefined;
  deliveryUrl: string | undefined;
}

/**
 * Pick a subtitle track based on SubtitleMode:
 *
 * - **Off**: no subtitles.
 * - **OnlyForced**: pick first forced track (prefer default among forced).
 * - **Always**: pick first track (prefer default).
 */
export function pickSubtitleTrack(tracks: SubtitleTrack[], mode: SubtitleMode): SubtitlePick {
  if (mode === "Off" || tracks.length === 0) {
    return { index: undefined, deliveryUrl: undefined };
  }

  if (mode === "OnlyForced") {
    const forced = tracks.filter((t) => t.isForced);
    if (forced.length === 0) {
      return { index: undefined, deliveryUrl: undefined };
    }
    const pick = forced.find((t) => t.isDefault) ?? forced[0];
    return { index: pick.index, deliveryUrl: pick.deliveryUrl };
  }

  // Always
  const pick = tracks.find((t) => t.isDefault) ?? tracks[0];
  return { index: pick.index, deliveryUrl: pick.deliveryUrl };
}
