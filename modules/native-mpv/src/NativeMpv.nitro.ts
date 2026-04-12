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
}
