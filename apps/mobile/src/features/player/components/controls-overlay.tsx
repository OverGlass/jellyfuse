// Full-screen player controls overlay. Auto-hides after 3s while
// playing. Single-tap toggles, double-tap left/right seeks ±10s
// and flashes a SeekIndicator at the edge. Pure component —
// props in / callbacks out. All gestures + Pressables are RNGH.

import { NerdIcon } from "@/features/common/components/nerd-icon";
import type { TrickplayData } from "@jellyfuse/api";
import type { AudioStream, Chapter, SubtitleTrack } from "@jellyfuse/models";
import { colors, fontSize, opacity, radius, spacing, withAlpha } from "@jellyfuse/theme";
import { Activity, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, Pressable } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { PlayerScrubber } from "./player-scrubber";
import { SeekIndicator } from "./seek-indicator";

const AUTO_HIDE_MS = 3_000;
const SEEK_SECONDS = 10;

interface Props {
  title: string;
  subtitle?: string;
  isPlaying: boolean;
  isBuffering: boolean;
  position: number;
  duration: number;
  chapters?: Chapter[];
  trickplay?: TrickplayData;
  audioStreams?: AudioStream[];
  subtitleTracks?: SubtitleTrack[];
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
  onSkipForward: () => void;
  onSkipBackward: () => void;
  onDismiss: () => void;
  onOpenTrackPicker?: () => void;
}

export function ControlsOverlay({
  title,
  subtitle,
  isPlaying,
  isBuffering,
  position,
  duration,
  chapters,
  trickplay,
  onPlayPause,
  onSeek,
  onSkipForward,
  onSkipBackward,
  onDismiss,
  onOpenTrackPicker,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [userDismissed, setUserDismissed] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  // Monotonic counters — bump to replay the edge indicator animation.
  const [leftSeekTrigger, setLeftSeekTrigger] = useState(0);
  const [rightSeekTrigger, setRightSeekTrigger] = useState(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always show while paused / scrubbing / buffering.
  const showControls = !userDismissed || !isPlaying || isScrubbing || isBuffering;

  function scheduleHide() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setUserDismissed(true), AUTO_HIDE_MS);
  }

  function handleToggle() {
    if (showControls) {
      setUserDismissed(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      setUserDismissed(false);
      if (isPlaying) scheduleHide();
    }
  }

  function handleInteraction() {
    if (isPlaying) scheduleHide();
  }

  function handleDoubleTap(absX: number) {
    if (absX < screenWidth / 2) {
      onSkipBackward();
      setLeftSeekTrigger((t) => t + 1);
    } else {
      onSkipForward();
      setRightSeekTrigger((t) => t + 1);
    }
    handleInteraction();
  }

  const singleTap = Gesture.Tap().onEnd(() => {
    "worklet";
    scheduleOnRN(handleToggle);
  });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      "worklet";
      scheduleOnRN(handleDoubleTap, e.absoluteX);
    });

  const backgroundGesture = Gesture.Exclusive(doubleTap, singleTap);

  useEffect(() => {
    if (userDismissed || !isPlaying || isScrubbing || isBuffering) return;
    const id = setTimeout(() => setUserDismissed(true), AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [isPlaying, userDismissed, isScrubbing, isBuffering]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Background gesture layer — full screen, always active. */}
      <GestureDetector gesture={backgroundGesture}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>

      {/* Edge seek indicators — animated, appear on double-tap */}
      <SeekIndicator
        side="left"
        triggerId={leftSeekTrigger}
        seconds={SEEK_SECONDS}
        insetHorizontal={Math.max(insets.left, spacing.xxl)}
      />
      <SeekIndicator
        side="right"
        triggerId={rightSeekTrigger}
        seconds={SEEK_SECONDS}
        insetHorizontal={Math.max(insets.right, spacing.xxl)}
      />

      {/* ── Controls overlay ───────────────────────────────────────── */}
      <Activity mode={showControls ? "visible" : "hidden"}>
        <Animated.View
          pointerEvents={showControls ? "box-none" : "none"}
          style={[
            styles.overlay,
            {
              paddingTop: Math.max(insets.top, spacing.md),
              paddingBottom: Math.max(insets.bottom, spacing.md),
              paddingLeft: Math.max(insets.left, spacing.lg),
              paddingRight: Math.max(insets.right, spacing.lg),
              opacity: showControls ? 1 : 0,
              transitionProperty: "opacity",
              transitionDuration: 200,
            },
          ]}
        >
          {/* ── Top row: back + title + CC ─────────────────────────── */}
          <View style={styles.topRow} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close player"
              onPress={onDismiss}
              hitSlop={12}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            >
              <NerdIcon name="chevronLeft" size={24} />
            </Pressable>
            <View style={styles.titleBlock} pointerEvents="none">
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
            </View>
            {onOpenTrackPicker ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Audio and subtitle tracks"
                onPress={onOpenTrackPicker}
                hitSlop={12}
                style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
              >
                <NerdIcon name="closedCaptioning" size={22} />
              </Pressable>
            ) : null}
          </View>

          {/* ── Center: play/pause (or spinner while buffering) ────── */}
          <View style={styles.centerRow} pointerEvents="box-none">
            {isBuffering ? (
              <View style={styles.playBtn}>
                <ActivityIndicator size="large" color={colors.textPrimary} />
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? "Pause" : "Play"}
                onPress={() => {
                  onPlayPause();
                  handleInteraction();
                }}
                hitSlop={16}
                style={({ pressed }) => [styles.playBtn, pressed && styles.playBtnPressed]}
              >
                <NerdIcon
                  style={!isPlaying ? styles.playBtnIcon : undefined}
                  name={isPlaying ? "pause" : "play"}
                  size={44}
                />
              </Pressable>
            )}
          </View>

          {/* ── Bottom: scrubber + times ───────────────────────────── */}
          <View style={styles.bottomRow} pointerEvents="box-none">
            <PlayerScrubber
              position={position}
              duration={duration}
              chapters={chapters}
              trickplay={trickplay}
              onSeek={(s) => {
                onSeek(s);
                handleInteraction();
              }}
              onDragStateChange={setIsScrubbing}
            />
          </View>
        </Animated.View>
      </Activity>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: withAlpha(colors.black, opacity.alpha45),
    justifyContent: "space-between",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnPressed: {
    opacity: opacity.pressed,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: "600",
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  centerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  playBtn: {
    width: 80,
    height: 80,
    borderRadius: radius.full,
    backgroundColor: withAlpha(colors.white, opacity.alpha15),
    alignItems: "center",
    justifyContent: "center",
  },
  playBtnIcon: {
    marginLeft: 4,
  },
  playBtnPressed: {
    opacity: opacity.pressed,
  },
  bottomRow: {
    gap: spacing.sm,
  },
});
