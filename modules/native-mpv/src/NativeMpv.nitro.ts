import type { HybridObject } from "react-native-nitro-modules";

/**
 * `@jellyfuse/native-mpv` — libmpv Nitro module for Jellyfuse.
 *
 * Phase 3a scope (this file): audio-only hybrid object + event
 * listeners. Phase 3b adds a Fabric `MpvView` backed by
 * `mpv_render_context` that consumes the same hybrid object instance
 * via a ref.
 *
 * Spec mirrors the high-level API of `jf-module-player::backend.rs`
 * in the Rust reference (see `../fusion`).
 * Type names use Jellyfuse's camelCase conventions; the underlying
 * mpv property and command names live inside the Swift impl.
 *
 * **Event model** — uses Nitro's canonical listener pattern (see
 * the MMKV `addOnValueChangedListener` spec + the Nitro docs at
 * docs/types/callbacks.md). Each `addXxxListener(cb)` returns a
 * `Listener` whose `remove()` disposes the subscription. Nitro
 * reference-counts callbacks so they can be called repeatedly and
 * live as long as the hybrid object needs them.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Listener handle (mirrors MMKV's Listener interface)
// ──────────────────────────────────────────────────────────────────────────────

export interface MpvListener {
  remove: () => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Value types (plain JSON-serialisable, no functions)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Options passed to `load(streamUrl, options)` when starting
 * playback. Every field is optional — callers can pass an empty
 * object for the simplest case. Populated from the playback resolver
 * in Phase 3c.
 */
/**
 * One external subtitle file to load alongside the main stream. Used
 * for offline playback of downloaded sidecar subs (`.vtt` / `.srt` /
 * `.ass`) — the URI is a local `file://` path. Each entry becomes a
 * separate track in mpv's track-list with the given `title` / `language`.
 */
export interface MpvExternalSubtitle {
  /** Absolute URI — `file://...` for local, `https://...` for remote. */
  uri: string;
  /** Display title shown in the track picker. Defaults to filename. */
  title?: string;
  /** ISO 639 language code. */
  language?: string;
}

export interface MpvLoadOptions {
  /** Seek to this offset (seconds) on start. Undefined = 0. */
  startPositionSeconds?: number;
  /** Preferred audio track index at load time. Undefined = mpv default. */
  audioTrackIndex?: number;
  /** Preferred subtitle track index at load time. Undefined = mpv default. */
  subtitleTrackIndex?: number;
  /** Initial playback rate. Undefined = 1.0. */
  playbackRate?: number;
  /** Initial volume 0–100. Undefined = 100. */
  volume?: number;
  /**
   * Optional HTTP `User-Agent` header override. Some Jellyfin
   * transcode endpoints require a specific UA for playback session
   * affinity.
   */
  userAgent?: string;
  /**
   * External subtitle files to attach after `loadfile`. Each runs
   * through `sub-add <uri> auto <title> <lang>`. The new tracks appear
   * in the track list via `addTracksListener` once mpv finishes
   * parsing them.
   *
   * Order matters: mpv assigns sids sequentially (embedded tracks
   * first, then externals in sub-add order). Callers map from a
   * Jellyfin/UI index to an mpv sid by position — so pass these in
   * the same order as they appear in the UI's subtitle list, and do
   * NOT interleave with embedded tracks. Mirrors
   * `crates/jf-ui-kit/src/views/player/mod.rs::PlayerView::new`.
   */
  externalSubtitles?: MpvExternalSubtitle[];
}

export type MpvPlaybackState = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export interface MpvAudioTrack {
  /** mpv track id (`aid=N`). */
  id: number;
  /** Display title (language + codec + layout). */
  title: string;
  /** ISO 639 language code if declared. */
  language?: string;
  /** Codec name from mpv's track-list. */
  codec?: string;
  /** Channel layout ("5.1", "stereo", …). */
  channels?: string;
  /** mpv's `default` flag. */
  isDefault: boolean;
}

export interface MpvSubtitleTrack {
  /** mpv track id (`sid=N`). */
  id: number;
  title: string;
  language?: string;
  codec?: string;
  /** The Jellyfin `Forced` flag for this track. */
  isForced: boolean;
  isDefault: boolean;
}

/**
 * Now-playing metadata shown on the iOS lock screen / Control Center
 * and (on Android) in the media-style notification. Pushed once per
 * session via `setNowPlayingMetadata`; elapsed time + playback rate
 * are kept in sync automatically from the existing progress + pause
 * property observers. Pass `null` to clear (on stop / release).
 */
export interface MpvNowPlayingInfo {
  title: string;
  /** Shown under the title — "SeriesName · S01E02" or artist. */
  subtitle?: string;
  /** Absolute URL — "https://..." or "file://...". Downloaded + cached natively. */
  artworkUri?: string;
  /** Full duration in seconds. Omit for live streams. */
  durationSeconds?: number;
  /** Live-stream flag — hides scrubber, disables seek commands. */
  isLiveStream?: boolean;
}

/**
 * One bitmap subtitle event (PGS / VobSub / DVB). Emitted by the
 * sidecar ffmpeg decoder — see docs/native-video-pipeline.md Phase 3.
 *
 * `imageUri` is a `data:image/png;base64,...` data URI the JS overlay
 * feeds directly into an `<Image>` — no pixel-pushing libs needed. PGS
 * rects are tiny (a few hundred bytes per PNG after compression) and
 * only fire every 2–3 s during dialogue, so the base64 expansion + JSI
 * crossing is negligible.
 *
 * `x` / `y` / `width` / `height` are in the source video's coordinate
 * system (1920×1080 for PGS, 720×480 for DVD, etc.). The overlay scales
 * them against the on-screen video rect before rendering. For clears,
 * subscribe to `addBitmapSubtitleClearListener` — the decoder emits a
 * dedicated clear event whenever a composition-delete packet arrives,
 * so the overlay doesn't need to track duration timers.
 */
export interface MpvBitmapSubtitle {
  ptsSeconds: number;
  durationSeconds: number;
  x: number;
  y: number;
  width: number;
  height: number;
  imageUri: string;
}

/**
 * Remote-control commands dispatched from the lock screen /
 * Control Center / AirPods. The optional `value` carries the
 * scrub target (in seconds) for `changePlaybackPosition`.
 */
export type MpvRemoteCommand =
  | "play"
  | "pause"
  | "togglePlayPause"
  | "skipForward"
  | "skipBackward"
  | "changePlaybackPosition"
  | "nextTrack"
  | "previousTrack";

// ──────────────────────────────────────────────────────────────────────────────
// HybridObject
// ──────────────────────────────────────────────────────────────────────────────

/**
 * One instance per player session. Create via
 * `NitroModules.createHybridObject<NativeMpv>("NativeMpv")`, attach
 * listeners via `addXxxListener(...)`, `load()` a stream URL, and
 * always call `release()` before unmount.
 */
export interface NativeMpv extends HybridObject<{ ios: "swift" }> {
  /**
   * Unique identifier for this player instance. Used to connect a
   * `MpvVideoView` to this player via `attachPlayer(instanceId)`.
   */
  readonly instanceId: string;

  // ── lifecycle ──────────────────────────────────────────────────────────
  /**
   * Load a stream URL. Tears down any previous load. Transitions
   * through `"loading"` → `"playing"` when the first packet is
   * decoded (observable via `addStateChangeListener`).
   */
  load(streamUrl: string, options: MpvLoadOptions): void;

  /** Tear down the `mpv_handle` and detach observers. Safe to call twice. */
  release(): void;

  // ── transport ──────────────────────────────────────────────────────────
  play(): void;
  pause(): void;
  /** Absolute seek, in seconds. Clamped to the stream duration. */
  seek(positionSeconds: number): void;

  // ── tracks + rate + volume ─────────────────────────────────────────────
  setAudioTrack(trackId: number): void;
  setSubtitleTrack(trackId: number): void;
  /** Disable subtitle rendering entirely (`sid=no`). */
  disableSubtitles(): void;
  /** Playback rate. Clamped to [0.25, 3.0]. */
  setRate(rate: number): void;
  /** 0–100. Clamped. */
  setVolume(volume: number): void;

  // ── generic property bridge ────────────────────────────────────────────
  /**
   * Low-level mpv property setter. Escape hatch for properties the
   * typed helpers above don't cover (e.g. `"sub-delay"`,
   * `"audio-device"`).
   */
  setProperty(name: string, value: string): void;
  /** Read a property as a string. Returns `""` if unset or on error. */
  getProperty(name: string): string;

  // ── event listeners ────────────────────────────────────────────────────
  /** Fired ~once per second while playing. Times in seconds. */
  addProgressListener(
    onProgress: (positionSeconds: number, durationSeconds: number) => void,
  ): MpvListener;

  /** Playback state transitions. */
  addStateChangeListener(onStateChange: (state: MpvPlaybackState) => void): MpvListener;

  /** End of stream. */
  addEndedListener(onEnded: () => void): MpvListener;

  /** Unrecoverable errors. JS should show an error screen + release. */
  addErrorListener(onError: (message: string) => void): MpvListener;

  /**
   * Discovered tracks after a successful `load`. Full audio + subtitle
   * track lists come through here so the UI can populate pickers
   * without another round trip to the server.
   */
  addTracksListener(
    onTracksDiscovered: (audio: MpvAudioTrack[], subtitle: MpvSubtitleTrack[]) => void,
  ): MpvListener;

  /** Buffering / seek spinner. `progress` is 0–1 if mpv reports it, else 0. */
  addBufferingListener(onBuffering: (isBuffering: boolean, progress: number) => void): MpvListener;

  /**
   * Current subtitle caption as plain text. Fires each time mpv
   * crosses a subtitle boundary (including on → off with an empty
   * string). Empty string means no active caption.
   *
   * Source: mpv's `sub-text` property — strips ASS tags, preserves
   * newlines. Used by the JS subtitle overlay; forms the data path
   * that Phase 2 of the native video pipeline (see
   * `docs/native-video-pipeline.md`) leans on once mpv stops
   * compositing subs into the video frame itself.
   */
  addSubtitleTextListener(onSubtitleText: (text: string) => void): MpvListener;

  /**
   * Emitted when a bitmap-subtitle show packet is decoded. Bitmap subs
   * (PGS on Blu-ray, VobSub on DVD, DVB broadcast) go through a
   * sidecar ffmpeg context rather than through mpv's compositor — see
   * docs/native-video-pipeline.md Phase 3. The listener receives raw
   * RGBA pixels and source-video-coordinate position; the JS overlay
   * owns all scaling + layering.
   *
   * Fires only when the currently selected subtitle track is a bitmap
   * codec. Pair with `addBitmapSubtitleClearListener` to handle the
   * hide events that PGS streams emit between dialogue lines.
   */
  addBitmapSubtitleListener(onBitmapSubtitle: (event: MpvBitmapSubtitle) => void): MpvListener;

  /** Bitmap subtitle hide event — clear the overlay. */
  addBitmapSubtitleClearListener(onClear: () => void): MpvListener;

  // ── lock-screen / Control Center integration ────────────────────────────
  /**
   * Publish now-playing metadata to `MPNowPlayingInfoCenter` (iOS) or
   * the MediaSession (Android, TBD). Pass `null` to clear — should be
   * called on session teardown so the lock screen doesn't show stale
   * info. Elapsed time + playback rate are auto-synced from the
   * internal progress + pause observers.
   */
  setNowPlayingMetadata(info: MpvNowPlayingInfo | null): void;

  /**
   * Subscribe to remote-control events (lock screen buttons, AirPods
   * double-tap, Control Center scrubber). JS is responsible for
   * mapping the command to `play()` / `pause()` / `seek(...)` — the
   * native side only dispatches, it does not mutate playback
   * automatically. This keeps the business logic (skip-intro, next
   * episode queue, etc.) in one place.
   */
  addRemoteCommandListener(
    onRemoteCommand: (command: MpvRemoteCommand, value: number) => void,
  ): MpvListener;
}
