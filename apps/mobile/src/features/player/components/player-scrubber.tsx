// Draggable scrubber bar with chapter markers and time display.
// Pure component — position/duration come from props, seek fires
// a callback. Chapter markers render as small vertical lines.

import type { Chapter } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, radius, spacing } from "@jellyfuse/theme";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

const TRACK_HEIGHT = 4;
const THUMB_SIZE = 16;

interface Props {
  position: number;
  duration: number;
  chapters?: Chapter[];
  onSeek: (seconds: number) => void;
}

export function PlayerScrubber({ position, duration, chapters, onSeek }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragProgress = useSharedValue(0);

  const progress = duration > 0 ? position / duration : 0;

  const panGesture = Gesture.Pan()
    .onStart((e) => {
      const p = Math.max(0, Math.min(1, e.x / trackWidth));
      dragProgress.value = p;
      runOnJS(setIsDragging)(true);
    })
    .onUpdate((e) => {
      const p = Math.max(0, Math.min(1, e.x / trackWidth));
      dragProgress.value = p;
    })
    .onEnd(() => {
      const seekTo = dragProgress.value * duration;
      runOnJS(onSeek)(seekTo);
      runOnJS(setIsDragging)(false);
    })
    .hitSlop({ top: 40, bottom: 40, left: 10, right: 10 });

  const tapGesture = Gesture.Tap().onEnd((e) => {
    if (trackWidth <= 0 || duration <= 0) return;
    const p = Math.max(0, Math.min(1, e.x / trackWidth));
    const seekTo = p * duration;
    runOnJS(onSeek)(seekTo);
  });

  const gesture = Gesture.Race(panGesture, tapGesture);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${(isDragging ? dragProgress.value : progress) * 100}%` as `${number}%`,
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    left: (isDragging ? dragProgress.value : progress) * trackWidth - THUMB_SIZE / 2,
  }));

  return (
    <View style={styles.root}>
      {/* Time display */}
      <View style={styles.timeRow}>
        <Text style={styles.time}>
          {formatTime(isDragging ? dragProgress.value * duration : position)}
        </Text>
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>

      {/* Scrubber track */}
      <GestureDetector gesture={gesture}>
        <View
          style={styles.trackContainer}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        >
          {/* Background track */}
          <View style={styles.track} />

          {/* Fill */}
          <Animated.View style={[styles.fill, fillStyle]} />

          {/* Chapter markers */}
          {chapters?.map((chapter) => {
            const chapterProgress =
              duration > 0 ? chapter.startPositionTicks / 10_000_000 / duration : 0;
            if (chapterProgress <= 0 || chapterProgress >= 1) return null;
            return (
              <View
                key={chapter.startPositionTicks}
                style={[styles.chapterMarker, { left: `${chapterProgress * 100}%` }]}
              />
            );
          })}

          {/* Thumb — visible on drag */}
          {isDragging ? <Animated.View style={[styles.thumb, thumbStyle]} /> : null}
        </View>
      </GestureDetector>
    </View>
  );
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xs,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  time: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  trackContainer: {
    height: 44,
    justifyContent: "center",
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  fill: {
    position: "absolute",
    left: 0,
    height: TRACK_HEIGHT,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  chapterMarker: {
    position: "absolute",
    width: 2,
    height: 10,
    backgroundColor: "rgba(255,255,255,0.5)",
    borderRadius: 1,
    top: "50%",
    marginTop: -5,
  },
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.accent,
    top: "50%",
    marginTop: -THUMB_SIZE / 2,
  },
});
