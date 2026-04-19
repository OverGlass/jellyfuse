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
import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { TrickplayThumbnail } from "./trickplay-thumbnail";

// Reanimated-friendly text node — we drive the left time label by
// assigning the native `text` prop from a worklet, so the label
// re-renders on the UI thread at mpv's tick rate without any React
// work.
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

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
  duration: number;
  /** UI-thread position mirror — drives the fill/thumb/time text without re-rendering React. */
  positionShared: SharedValue<number>;
  /** UI-thread duration mirror. */
  durationShared: SharedValue<number>;
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
  duration,
  positionShared,
  durationShared,
  chapters,
  trickplay,
  onSeek,
  onDragStateChange,
}: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragSeconds, setDragSeconds] = useState(0);
  const dragProgress = useSharedValue(0);
  // Throttle JS-side drag state updates to ~20Hz. The thumb and fill
  // animate on the UI thread via dragProgress (shared value) so the
  // scrubber stays silky; we only need the JS state to drive the
  // trickplay thumbnail + chapter name — neither benefits from
  // 120Hz updates.
  const lastUpdateMs = useRef(0);

  const segments = buildSegments(chapters, duration);

  // Active chapter is only visually used *during* drag — the
  // emphasised mask segment, chapter-name label, and active
  // highlight all gate on `isDragging`. Computing activeIndex during
  // idle playback would force a re-render whenever the playhead
  // crosses a chapter boundary, so we skip it entirely.
  const activeIndex = isDragging
    ? segments.findIndex((s) => dragSeconds >= s.startSeconds && dragSeconds < s.endSeconds)
    : -1;
  const activeChapter = activeIndex >= 0 ? segments[activeIndex] : undefined;

  function setDraggingWithNotify(dragging: boolean) {
    setIsDragging(dragging);
    onDragStateChange?.(dragging);
  }

  function onDragUpdate(p: number) {
    setDragSeconds(p * duration);
  }

  function onDragUpdateThrottled(p: number) {
    const now = Date.now();
    if (now - lastUpdateMs.current < 50) return;
    lastUpdateMs.current = now;
    setDragSeconds(p * duration);
  }

  const panGesture = Gesture.Pan()
    .onStart((e) => {
      "worklet";
      const p = Math.max(0, Math.min(1, e.x / trackWidth));
      dragProgress.value = p;
      scheduleOnRN(setDraggingWithNotify, true);
      scheduleOnRN(onDragUpdate, p);
    })
    .onUpdate((e) => {
      "worklet";
      const p = Math.max(0, Math.min(1, e.x / trackWidth));
      dragProgress.value = p;
      scheduleOnRN(onDragUpdateThrottled, p);
    })
    .onEnd(() => {
      "worklet";
      const seekTo = dragProgress.value * duration;
      scheduleOnRN(onDragUpdate, dragProgress.value);
      scheduleOnRN(onSeek, seekTo);
      scheduleOnRN(setDraggingWithNotify, false);
    })
    .hitSlop({ top: 40, bottom: 40, left: 10, right: 10 });

  const tapGesture = Gesture.Tap().onEnd((e) => {
    "worklet";
    if (trackWidth <= 0 || duration <= 0) return;
    const p = Math.max(0, Math.min(1, e.x / trackWidth));
    const seekTo = p * duration;
    scheduleOnRN(onSeek, seekTo);
  });

  const gesture = Gesture.Race(panGesture, tapGesture);

  const fillStyle = useAnimatedStyle(() => {
    const dur = durationShared.value;
    const liveProgress = dur > 0 ? positionShared.value / dur : 0;
    const p = isDragging ? dragProgress.value : liveProgress;
    return { width: `${p * 100}%` as `${number}%` };
  });

  const thumbStyle = useAnimatedStyle(() => {
    const dur = durationShared.value;
    const liveProgress = dur > 0 ? positionShared.value / dur : 0;
    const p = isDragging ? dragProgress.value : liveProgress;
    return { left: p * trackWidth - THUMB_SIZE / 2 };
  });

  // Left time label rides the shared position value directly, so
  // the text updates on the UI thread without a React re-render.
  // During drag we show dragProgress × duration (matches the thumb).
  const currentTimeProps = useAnimatedProps(() => {
    const secs = isDragging ? dragProgress.value * durationShared.value : positionShared.value;
    const text = formatTime(secs);
    return { text, defaultValue: text };
  });

  return (
    <View style={styles.root}>
      {/* Time display */}
      <View style={styles.timeRow}>
        <AnimatedTextInput editable={false} style={styles.time} animatedProps={currentTimeProps} />
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>

      {/* Scrubber track */}
      <GestureDetector gesture={gesture}>
        <View
          style={styles.trackContainer}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        >
          <ScrubberMask
            segments={segments}
            activeIndex={activeIndex}
            isDragging={isDragging}
            trackWidth={trackWidth}
            activeChapter={activeChapter}
            duration={duration}
            fillStyle={fillStyle}
          />

          {/* Thumb — visible on drag */}
          {isDragging ? <Animated.View style={[styles.thumb, thumbStyle]} /> : null}

          {isDragging ? (
            <DragPreview
              progress={dragProgress}
              duration={duration}
              trackWidth={trackWidth}
              trickplay={trickplay}
              activeChapter={activeChapter}
            />
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

// Isolated so the expensive segment map only re-renders when
// activeIndex crosses a chapter boundary, not on every drag tick.
// React Compiler caches this by props.
interface ScrubberMaskProps {
  segments: Segment[];
  activeIndex: number;
  isDragging: boolean;
  trackWidth: number;
  activeChapter: Segment | undefined;
  duration: number;
  fillStyle: StyleProp<ViewStyle>;
}

function ScrubberMask({
  segments,
  activeIndex,
  isDragging,
  trackWidth,
  activeChapter,
  duration,
  fillStyle,
}: ScrubberMaskProps) {
  return (
    <View
      style={[
        styles.trackWrapper,
        {
          height: ACTIVE_SEGMENT_HEIGHT,
          transitionProperty: "height",
          transitionDuration: HEIGHT_TRANSITION_MS,
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
              const leftPx = (seg.startPct / 100) * trackWidth + (i === 0 ? 0 : SEGMENT_GAP / 2);
              const rightTrimPx = i === segments.length - 1 ? 0 : SEGMENT_GAP / 2;
              const widthPx =
                (seg.widthPct / 100) * trackWidth - (i === 0 ? 0 : SEGMENT_GAP / 2) - rightTrimPx;
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
        <View style={styles.bgBar} />

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

        <Animated.View style={[styles.fill, fillStyle]} />
      </MaskedView>
    </View>
  );
}

// Per-tick body during drag — anchor left and trickplay crop both
// ride the shared progress value on the UI thread, so this component
// only re-renders when activeChapter / trickplay / trackWidth change.
interface DragPreviewProps {
  progress: SharedValue<number>;
  duration: number;
  trackWidth: number;
  trickplay: TrickplayData | undefined;
  activeChapter: Segment | undefined;
}

function DragPreview({
  progress,
  duration,
  trackWidth,
  trickplay,
  activeChapter,
}: DragPreviewProps) {
  const anchorStyle = useAnimatedStyle(() => {
    const dragX = progress.value * trackWidth;
    return {
      left: Math.max(
        0,
        Math.min(trackWidth - CHAPTER_LABEL_WIDTH, dragX - CHAPTER_LABEL_WIDTH / 2),
      ),
    };
  });

  return (
    <Animated.View style={[styles.previewAnchor, anchorStyle]}>
      {trickplay ? (
        <TrickplayThumbnail trickplay={trickplay} progress={progress} duration={duration} />
      ) : null}
      {activeChapter && activeChapter.name ? (
        <View style={styles.chapterLabel}>
          <Text style={styles.chapterName} numberOfLines={1}>
            {activeChapter.name}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

function formatTime(seconds: number): string {
  "worklet";
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
    // Zero padding/border so the animated TextInput sits flush with
    // the static Text on the right.
    padding: 0,
    margin: 0,
    borderWidth: 0,
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
