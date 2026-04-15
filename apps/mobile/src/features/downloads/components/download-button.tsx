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
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { NerdIcon } from "@/features/common/components/nerd-icon";

const BUTTON_SIZE = 44;
const RING_SIZE = BUTTON_SIZE;
const RING_STROKE = 3;

interface Props {
  record: DownloadRecord | undefined;
  onPress: () => void;
  size?: number;
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

export function DownloadButton({ record, onPress, size = BUTTON_SIZE }: Props) {
  const state = record?.state;
  const progress = record && record.bytesTotal > 0 ? record.bytesDownloaded / record.bytesTotal : 0;

  // Animate the progress ring stroke dash offset
  const animatedProgress = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    Animated.timing(animatedProgress, {
      toValue: progress,
      duration: duration.normal,
      useNativeDriver: false,
    }).start();
  }, [animatedProgress, progress]);

  const showRing = state === "queued" || state === "downloading";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Download: ${state ?? "not downloaded"}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size },
        pressed && styles.pressed,
      ]}
    >
      {showRing ? (
        <View style={styles.ringContainer}>
          {/* Background track */}
          <View
            style={[
              styles.ringTrack,
              {
                width: RING_SIZE,
                height: RING_SIZE,
                borderRadius: RING_SIZE / 2,
                borderWidth: RING_STROKE,
              },
            ]}
          />
        </View>
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
  ringContainer: {
    alignItems: "center",
    justifyContent: "center",
    ...StyleSheet.absoluteFillObject,
  },
  ringTrack: {
    borderColor: `${colors.textPrimary}30`,
    position: "absolute",
  },
});
