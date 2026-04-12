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

/**
 * Create a fresh `NativeMpv` hybrid object instance. One instance =
 * one player session. Always `release()` before unmount to tear
 * down the `mpv_handle` and detach observers.
 *
 * Usage (audio-only — phase 3a):
 *
 * ```ts
 * const mpv = createNativeMpv();
 * const sub = mpv.addProgressListener((pos, dur) => console.log(pos, dur));
 * mpv.load("https://example.test/audio.m4a", {});
 * // ...
 * sub.remove();
 * mpv.release();
 * ```
 *
 * Phase 3b adds a Fabric `<MpvView>` that owns one of these
 * instances internally and exposes it via a ref for controls.
 */
export function createNativeMpv(): NativeMpvSpec {
  return NitroModules.createHybridObject<NativeMpvSpec>("NativeMpv");
}
