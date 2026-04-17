/**
 * `DownloadButton` — shows the download state for a single media item
 * and lets the user trigger a download or cancel it.
 *
 * State → UI mapping:
 *   undefined / absent → cloud-download icon (not downloaded)
 *   queued / downloading → animated progress ring + X
 *   paused → play-circle icon (resume)
 *   done → checkmark-circle (already downloaded)
 *   failed → alert-circle (tap to retry)
 *
 * Pure component: all side effects are handled by `onPress` in the parent.
 */
import { colors, duration, opacity, type IconName } from "@jellyfuse/theme";
import type { DownloadRecord, DownloadState } from "@jellyfuse/models";
import MaskedView from "@react-native-masked-view/masked-view";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { NerdIcon } from "@/features/common/components/nerd-icon";

const BUTTON_SIZE = 44;
const RING_SIZE = BUTTON_SIZE;
const RING_STROKE = 3;
const RING_HALF = RING_SIZE / 2;

interface Props {
  record: DownloadRecord | undefined;
  onPress: () => void;
  size?: number;
  /**
   * Disable the button (offline + not-yet-downloaded). Dims the icon
   * and blocks presses. Done/queued/downloading records remain
   * interactive even when `disabled` is true so the user can still
   * pause, cancel, or delete what's already on device.
   */
  disabled?: boolean;
}

function iconForState(state: DownloadState | undefined): IconName {
  switch (state) {
    case "queued":
    case "downloading":
      return "close";
    case "paused":
      return "play";
    case "done":
      return "check";
    case "failed":
      return "warning";
    default:
      return "download";
  }
}

function colorForState(state: DownloadState | undefined): string {
  switch (state) {
    case "done":
      return colors.accent;
    case "failed":
      return colors.danger;
    default:
      return colors.textPrimary;
  }
}

export function DownloadButton({ record, onPress, size = BUTTON_SIZE, disabled = false }: Props) {
  const state = record?.state;
  // Only disable when nothing exists on device yet. Keep interactive for
  // records that represent stored / in-progress data (user may still
  // want to cancel, pause, retry, or delete them while offline).
  const effectiveDisabled = disabled && state === undefined;
  const progress = record && record.bytesTotal > 0 ? record.bytesDownloaded / record.bytesTotal : 0;

  const animatedProgress = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    Animated.timing(animatedProgress, {
      toValue: progress,
      duration: duration.normal,
      useNativeDriver: false,
    }).start();
  }, [animatedProgress, progress]);

  const showRing = state === "queued" || state === "downloading";

  // Right half of the ring fills over progress 0 → 0.5.
  // Left half fills over progress 0.5 → 1. Each half is a half-disk (D-shape)
  // that rotates around the ring centre; the surrounding clip hides the parts
  // of the disk that haven't swept in yet.
  const rightRotate = animatedProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["180deg", "360deg", "360deg"],
  });
  const leftRotate = animatedProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["180deg", "180deg", "360deg"],
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Download: ${state ?? "not downloaded"}`}
      accessibilityState={{ disabled: effectiveDisabled }}
      disabled={effectiveDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size },
        pressed && styles.pressed,
        effectiveDisabled && styles.disabled,
      ]}
    >
      {showRing ? (
        <MaskedView
          style={styles.ringContainer}
          maskElement={
            <View style={styles.ringMaskOuter}>
              <View style={styles.ringMaskStroke} />
            </View>
          }
        >
          <View style={styles.ringTrack} />
          <View style={styles.rightClip}>
            <Animated.View style={[styles.rightFill, { transform: [{ rotate: rightRotate }] }]} />
          </View>
          <View style={styles.leftClip}>
            <Animated.View style={[styles.leftFill, { transform: [{ rotate: leftRotate }] }]} />
          </View>
        </MaskedView>
      ) : null}
      <NerdIcon name={iconForState(state)} size={size * 0.55} color={colorForState(state)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: opacity.pressed,
  },
  disabled: {
    opacity: opacity.disabled,
  },
  ringContainer: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
  },
  ringMaskOuter: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  ringMaskStroke: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_HALF,
    borderWidth: RING_STROKE,
    borderColor: "black",
  },
  ringTrack: {
    position: "absolute",
    width: RING_SIZE,
    height: RING_SIZE,
    backgroundColor: `${colors.textPrimary}30`,
  },
  rightClip: {
    position: "absolute",
    left: RING_HALF,
    top: 0,
    width: RING_HALF,
    height: RING_SIZE,
    overflow: "hidden",
  },
  rightFill: {
    width: RING_HALF,
    height: RING_SIZE,
    backgroundColor: colors.accent,
    borderTopRightRadius: RING_HALF,
    borderBottomRightRadius: RING_HALF,
    transformOrigin: "0% 50%",
  },
  leftClip: {
    position: "absolute",
    left: 0,
    top: 0,
    width: RING_HALF,
    height: RING_SIZE,
    overflow: "hidden",
  },
  leftFill: {
    width: RING_HALF,
    height: RING_SIZE,
    backgroundColor: colors.accent,
    borderTopLeftRadius: RING_HALF,
    borderBottomLeftRadius: RING_HALF,
    transformOrigin: "100% 50%",
  },
});
