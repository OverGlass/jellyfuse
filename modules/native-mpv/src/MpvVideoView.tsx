import { getHostComponent } from "react-native-nitro-modules";
import type { MpvVideoViewMethods, MpvVideoViewProps } from "./MpvVideoView.nitro";
import MpvVideoViewConfig from "../nitrogen/generated/shared/json/MpvVideoViewConfig.json";

/**
 * Native view component that renders mpv video frames via OpenGL ES.
 *
 * Connect to a `NativeMpv` player instance using `hybridRef`:
 * ```tsx
 * const mpv = createNativeMpv();
 * <MpvVideoView
 *   style={{ width: '100%', aspectRatio: 16/9 }}
 *   hybridRef={callback((ref) => ref?.attachPlayer(mpv.instanceId))}
 * />
 * ```
 */
export const MpvVideoView = getHostComponent<MpvVideoViewProps, MpvVideoViewMethods>(
  "MpvVideoView",
  () => MpvVideoViewConfig,
);
