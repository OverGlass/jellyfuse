// YouTube-style segmented scrubber with chapter gaps, grow-on-drag,
// and active-segment emphasis. Uses MaskedView to clip continuous
// fill + background through a row of segment shapes.
//
// Layout rule: the touch container has a FIXED 44pt height so the
// controls overlay never shifts when the track grows on drag. The
// MaskedView inside animates its height independently.

import type { TrickplayData } from "@jellyfuse/api";
import type { Chapter } from "@jellyfuse/models";
import {
  colors,
  fontSize,
  fontWeight,
  opacity,
  radius,
  spacing,
  withAlpha,
} from "@jellyfuse/theme";
import MaskedView from "@react-native-masked-view/masked-view";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { TrickplayThumbnail } from "./trickplay-thumbnail";

// Heights — the container is fixed; only the visual track grows.
const CONTAINER_HEIGHT = 44;
const TRACK_HEIGHT_IDLE = 6;
const TRACK_HEIGHT_DRAG = 10;
const THUMB_SIZE = 28;
// Active chapter segment matches the thumb diameter while dragging.
const ACTIVE_SEGMENT_HEIGHT = 14;
const SEGMENT_GAP = 2;
const CHAPTER_LABEL_WIDTH = 200;
const HEIGHT_TRANSITION_MS = 150;

interface Props {
  position: number;
  duration: number;
  chapters?: Chapter[];
  trickplay?: TrickplayData;
  onSeek: (seconds: number) => void;
  onDragStateChange?: (isDragging: boolean) => void;
}

interface Segment {
  startPct: number;
  widthPct: number;
  name: string;
  startSeconds: number;
  endSeconds: number;
}

function buildSegments(chapters: Chapter[] | undefined, duration: number): Segment[] {
  if (!duration || duration <= 0) return [];
  if (!chapters || chapters.length === 0) {
    return [{ startPct: 0, widthPct: 100, name: "", startSeconds: 0, endSeconds: duration }];
  }

  const sorted = [...chapters].sort((a, b) => a.startPositionTicks - b.startPositionTicks);
  return sorted.map((ch, i) => {
    const startSeconds = ch.startPositionTicks / 10_000_000;
    const endSeconds =
      i + 1 < sorted.length ? sorted[i + 1]!.startPositionTicks / 10_000_000 : duration;
    return {
      startPct: (startSeconds / duration) * 100,
      widthPct: ((endSeconds - startSeconds) / duration) * 100,
      name: ch.name,
      startSeconds,
      endSeconds,
    };
  });
}

export function PlayerScrubber({
  position,
  duration,
  chapters,
  trickplay,
  onSeek,
  onDragStateChange,
}: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragSeconds, setDragSeconds] = useState(0);
  const dragProgress = useSharedValue(0);

  const progress = duration > 0 ? position / duration : 0;
  const segments = buildSegments(chapters, duration);

  // Index of the segment currently being dragged (or current position when idle)
  const activeSeconds = isDragging ? dragSeconds : position;
  const activeIndex = segments.findIndex(
    (s) => activeSeconds >= s.startSeconds && activeSeconds < s.endSeconds,
  );
  const activeChapter = activeIndex >= 0 ? segments[activeIndex] : undefined;

  function setDraggingWithNotify(dragging: boolean) {
    setIsDragging(dragging);
    onDragStateChange?.(dragging);
  }

  function onDragUpdate(p: number) {
    setDragSeconds(p * duration);
  }

  const panGesture = Gesture.Pan()
    .onStart((e) => {
      "worklet";
      const p = Math.max(0, Math.min(1, e.x / trackWidth));
      dragProgress.value = p;
      runOnJS(setDraggingWithNotify)(true);
      runOnJS(onDragUpdate)(p);
    })
    .onUpdate((e) => {
      "worklet";
      const p = Math.max(0, Math.min(1, e.x / trackWidth));
      dragProgress.value = p;
      runOnJS(onDragUpdate)(p);
    })
    .onEnd(() => {
      "worklet";
      const seekTo = dragProgress.value * duration;
      runOnJS(onSeek)(seekTo);
      runOnJS(setDraggingWithNotify)(false);
    })
    .hitSlop({ top: 40, bottom: 40, left: 10, right: 10 });

  const tapGesture = Gesture.Tap().onEnd((e) => {
    "worklet";
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

  const dragX = duration > 0 ? (dragSeconds / duration) * trackWidth : 0;

  return (
    <View style={styles.root}>
      {/* Time display */}
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatTime(isDragging ? dragSeconds : position)}</Text>
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>

      {/* Scrubber track */}
      <GestureDetector gesture={gesture}>
        <View
          style={styles.trackContainer}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        >
          {/* Masked segmented track — center-aligned within the touch
              container. The MaskedView grows on drag (CSS transition)
              but the container stays fixed → no layout shift. */}
          <View
            style={[
              styles.trackWrapper,
              {
                height: ACTIVE_SEGMENT_HEIGHT,
                transitionProperty: "height",
                transitionDuration: 150,
              },
            ]}
          >
            <MaskedView
              style={StyleSheet.absoluteFill}
              maskElement={
                <View style={styles.maskRow}>
                  {segments.map((seg, i) => {
                    const isActive = isDragging && i === activeIndex;
                    const height = isDragging
                      ? isActive
                        ? ACTIVE_SEGMENT_HEIGHT
                        : TRACK_HEIGHT_DRAG
                      : TRACK_HEIGHT_IDLE;
                    const leftPx =
                      (seg.startPct / 100) * trackWidth + (i === 0 ? 0 : SEGMENT_GAP / 2);
                    const rightTrimPx = i === segments.length - 1 ? 0 : SEGMENT_GAP / 2;
                    const widthPx =
                      (seg.widthPct / 100) * trackWidth -
                      (i === 0 ? 0 : SEGMENT_GAP / 2) -
                      rightTrimPx;
                    const isFirst = i === 0;
                    const isLast = i === segments.length - 1;
                    const endRadius = height / 2;
                    return (
                      <Animated.View
                        key={i}
                        style={[
                          styles.maskSegment,
                          {
                            left: leftPx,
                            width: Math.max(0, widthPx),
                            height,
                            top: (ACTIVE_SEGMENT_HEIGHT - height) / 2,
                            // Round only the outer ends of the whole
                            // scrubber — the first segment's left and
                            // the last segment's right. Internal
                            // segment boundaries stay square.
                            borderTopLeftRadius: isFirst ? endRadius : 0,
                            borderBottomLeftRadius: isFirst ? endRadius : 0,
                            borderTopRightRadius: isLast ? endRadius : 0,
                            borderBottomRightRadius: isLast ? endRadius : 0,
                            transitionProperty: ["height", "top"],
                            transitionDuration: HEIGHT_TRANSITION_MS,
                          },
                        ]}
                      />
                    );
                  })}
                </View>
              }
            >
              {/* Background bar — dark, full width */}
              <View style={styles.bgBar} />

              {/* Active segment highlight — lighter, only at the
                  active chapter's bounds. Rendered behind the fill so
                  the accent still paints over the filled portion. */}
              {isDragging && activeChapter && duration > 0 ? (
                <View
                  style={[
                    styles.activeHighlight,
                    {
                      left: (activeChapter.startPct / 100) * trackWidth,
                      width: (activeChapter.widthPct / 100) * trackWidth,
                    },
                  ]}
                />
              ) : null}

              {/* Fill bar — continuous, masked by segments */}
              <Animated.View style={[styles.fill, fillStyle]} />
            </MaskedView>
          </View>

          {/* Thumb — visible on drag */}
          {isDragging ? <Animated.View style={[styles.thumb, thumbStyle]} /> : null}

          {/* Trickplay preview + chapter name — follow drag position.
              Wrapper is CHAPTER_LABEL_WIDTH wide, centered on dragX,
              clamped to stay within the track. Children align center. */}
          {isDragging ? (
            <View
              style={[
                styles.previewAnchor,
                {
                  left: Math.max(
                    0,
                    Math.min(trackWidth - CHAPTER_LABEL_WIDTH, dragX - CHAPTER_LABEL_WIDTH / 2),
                  ),
                },
              ]}
            >
              {trickplay ? (
                <TrickplayThumbnail trickplay={trickplay} positionSeconds={dragSeconds} />
              ) : null}
              {activeChapter && activeChapter.name ? (
                <View style={styles.chapterLabel}>
                  <Text style={styles.chapterName} numberOfLines={1}>
                    {activeChapter.name}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
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
    alignItems: "center",
  },
  time: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  trackContainer: {
    height: CONTAINER_HEIGHT,
    justifyContent: "center",
  },
  trackWrapper: {
    position: "relative",
    overflow: "visible",
  },
  maskRow: {
    ...StyleSheet.absoluteFillObject,
  },
  maskSegment: {
    position: "absolute",
    // Square ends — no border radius. Gaps alone define the breaks.
    backgroundColor: colors.black,
  },
  bgBar: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha(colors.white, opacity.alpha20),
  },
  activeHighlight: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: withAlpha(colors.white, opacity.alpha45),
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.accent,
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
  // Fixed-width wrapper above the scrubber, positioned so its
  // horizontal center sits at dragX. Children align center.
  previewAnchor: {
    position: "absolute",
    bottom: "100%",
    width: CHAPTER_LABEL_WIDTH,
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  chapterLabel: {
    marginTop: spacing.xs,
    maxWidth: CHAPTER_LABEL_WIDTH,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: withAlpha(colors.black, opacity.alpha50),
  },
  chapterName: {
    color: colors.textPrimary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    textAlign: "center",
  },
});
