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

export interface MpvVideoViewMethods extends HybridViewMethods {
  /**
   * Connect this render surface to a `NativeMpv` player instance.
   * Creates an OpenGL ES render context, enables video decoding
   * (`vid=auto`), and starts the CADisplayLink render loop.
   */
  attachPlayer(instanceId: string): void;

  /**
   * Disconnect from the player. Tears down the render context and
   * stops the display link. The player continues audio playback.
   */
  detachPlayer(): void;
}

export type MpvVideoView = HybridView<
  MpvVideoViewProps,
  MpvVideoViewMethods,
  { ios: "swift"; android: "kotlin" }
>;
