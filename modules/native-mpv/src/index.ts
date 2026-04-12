import { NitroModules } from "react-native-nitro-modules";
import type { NativeMpv as NativeMpvSpec } from "./NativeMpv.nitro";

export type {
  MpvAudioTrack,
  MpvListener,
  MpvLoadOptions,
  MpvPlaybackState,
  MpvSubtitleTrack,
  NativeMpv,
} from "./NativeMpv.nitro";

export { MpvVideoView } from "./MpvVideoView";

// Re-export `callback` so consumers don't need a direct nitro import
export { callback } from "react-native-nitro-modules";

/**
 * Create a fresh `NativeMpv` hybrid object instance. One instance =
 * one player session. Always `release()` before unmount to tear
 * down the `mpv_handle` and detach observers.
 *
 * Usage:
 * ```tsx
 * const mpv = createNativeMpv();
 * mpv.load("https://example.test/video.mp4", {});
 *
 * <MpvVideoView
 *   style={{ width: '100%', aspectRatio: 16/9 }}
 *   hybridRef={callback((ref) => ref?.attachPlayer(mpv.instanceId))}
 * />
 * ```
 */
export function createNativeMpv(): NativeMpvSpec {
  return NitroModules.createHybridObject<NativeMpvSpec>("NativeMpv");
}
