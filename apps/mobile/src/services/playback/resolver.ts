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
  /**
   * 3-letter ISO 639 language code for preferred audio track. Empty
   * string falls back to the stream's `isDefault` flag, then the first
   * stream. Matches Jellyfin's `UserConfiguration.AudioLanguagePreference`
   * shape (nullable string — we normalise to "" for the empty case).
   */
  preferredAudioLanguage: string;
  /**
   * 3-letter ISO 639 language code for preferred subtitle track. Only
   * used when `subtitleMode === "Smart"` (foreign-audio detection).
   * Matches Jellyfin's `UserConfiguration.SubtitleLanguagePreference`.
   */
  preferredSubtitleLanguage: string;
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
  const pickedAudio =
    audioStreamIndex !== undefined
      ? playbackInfo.audioStreams.find((s) => s.index === audioStreamIndex)
      : undefined;
  const { index: subtitleStreamIndex, deliveryUrl: subtitleDeliveryUrl } = pickSubtitleTrack(
    playbackInfo.subtitles,
    settings.subtitleMode,
    pickedAudio?.language,
    settings.preferredSubtitleLanguage,
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
 * Pick a subtitle track based on Jellyfin's `SubtitlePlaybackMode`:
 *
 * - **None**: no subtitles.
 * - **OnlyForced**: pick first forced track (prefer default among forced).
 * - **Default** / **Always**: pick default track, else first track.
 * - **Smart**: pick a subtitle only when the picked audio language does
 *   not match `preferredSubtitleLanguage` (foreign-audio detection).
 *   Prefers a subtitle track matching `preferredSubtitleLanguage`,
 *   falling back to default/first like `Default`.
 *
 * `pickedAudioLanguage` is the language of the audio track already
 * selected by `pickAudioStream`; `preferredSubtitleLanguage` is the
 * user's server-stored preference. Both are 3-letter ISO 639 codes
 * (or `""` / `undefined` when unknown).
 */
export function pickSubtitleTrack(
  tracks: SubtitleTrack[],
  mode: SubtitleMode,
  pickedAudioLanguage: string | undefined,
  preferredSubtitleLanguage: string,
): SubtitlePick {
  if (mode === "None" || tracks.length === 0) {
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

  // Smart — only pick when the audio language differs from the user's
  // preferred subtitle language. Falls through to "Default" logic once
  // we decide a subtitle is warranted.
  if (mode === "Smart") {
    const audioLang = (pickedAudioLanguage ?? "").toLowerCase();
    const subLang = preferredSubtitleLanguage.toLowerCase();
    if (!subLang || audioLang === subLang) {
      return { index: undefined, deliveryUrl: undefined };
    }
    const langMatches = tracks.filter(
      (t) => t.language !== undefined && t.language.toLowerCase() === subLang,
    );
    if (langMatches.length > 0) {
      const pick = langMatches.find((t) => t.isDefault) ?? langMatches[0];
      return { index: pick.index, deliveryUrl: pick.deliveryUrl };
    }
  }

  // Default / Always
  const pick = tracks.find((t) => t.isDefault) ?? tracks[0];
  return { index: pick.index, deliveryUrl: pick.deliveryUrl };
}
