import type { HybridView, HybridViewMethods, HybridViewProps } from "react-native-nitro-modules";

/**
 * `MpvVideoView` — Nitro HybridView backed by a CAEAGLLayer that
 * renders mpv video frames via `mpv_render_context`.
 *
 * Usage (React):
 * ```tsx
 * const mpv = createNativeMpv();
 * <MpvVideoView
 *   style={{ width: '100%', aspectRatio: 16/9 }}
 *   hybridRef={callback((ref) => ref?.attachPlayer(mpv.instanceId))}
 * />
 * ```
 *
 * The view is decoupled from the player lifecycle — audio continues
 * playing if the view unmounts (important for PiP transitions).
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MpvVideoViewProps extends HybridViewProps {}

/**
 * Selects which frame producer feeds the view's
 * `AVSampleBufferDisplayLayer`. Phase 2b ships the legacy
 * `"mpv"` path as the default; Phase 2c lights up `"native"` —
 * a parallel libavformat + VideoToolbox pipeline that decodes
 * straight into CVPixelBuffers (zero-copy, 10-bit HDR, Dolby
 * Vision). See `docs/native-video-pipeline-phase-2.md`.
 *
 * `"native"` currently falls back to `"mpv"` with a warning
 * until the decoder lands in Commit C3.
 */
export type MpvVideoSource = "mpv" | "native";

export interface MpvAttachOptions {
  /** Defaults to `"mpv"`. */
  source?: MpvVideoSource;
}

export interface MpvVideoViewMethods extends HybridViewMethods {
  /**
   * Connect this render surface to a `NativeMpv` player instance.
   * By default, creates an OpenGL ES render context, enables video
   * decoding (`vid=auto`), and starts the CADisplayLink render loop.
   *
   * Pass `{ source: "native" }` to select the VideoToolbox decoder
   * (Phase 2c — behind the feature flag for now).
   */
  attachPlayer(instanceId: string, options?: MpvAttachOptions): void;

  /**
   * Disconnect from the player. Tears down the render context and
   * stops the display link. The player continues audio playback.
   */
  detachPlayer(): void;
}

export type MpvVideoView = HybridView<MpvVideoViewProps, MpvVideoViewMethods, { ios: "swift" }>;
