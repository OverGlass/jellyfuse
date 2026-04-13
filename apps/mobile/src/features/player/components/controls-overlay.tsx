// Full-screen player controls overlay. Auto-hides after 3s while
// playing. Tap anywhere to toggle. Double-tap left/right to seek ±10s.
// Uses safe area insets so controls avoid the notch / Dynamic Island.
// Pure component — props in / callbacks out.
//
// Tap detection uses plain Pressable (not RNGH) so it doesn't block
// the overlay buttons. Double-tap is detected via timestamp tracking.

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
import { Activity, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlayerScrubber } from "./player-scrubber";

const AUTO_HIDE_MS = 3_000;
const DOUBLE_TAP_MS = 250;

interface Props {
  title: string;
  subtitle?: string;
  isPlaying: boolean;
  position: number;
  duration: number;
  chapters?: Chapter[];
  trickplay?: TrickplayData;
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
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  // Derived — paused OR scrubbing = always show.
  const showControls = !userDismissed || !isPlaying || isScrubbing;

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

  // Auto-hide: schedule a hide when controls are visible + playing +
  // NOT scrubbing. Syncing with an external timer system (setTimeout).
  // Re-runs when isPlaying / isScrubbing change so pause/drag cancel
  // the timer, play/release schedule a fresh one.
  useEffect(() => {
    if (userDismissed || !isPlaying || isScrubbing) return;
    const id = setTimeout(() => setUserDismissed(true), AUTO_HIDE_MS);
    return () => clearTimeout(id);
  }, [isPlaying, userDismissed, isScrubbing]);

  // Double-tap detection via timestamp. First tap waits DOUBLE_TAP_MS
  // for a potential second tap before toggling controls. If a second
  // tap arrives, treat as seek (±10s based on screen half).
  const pendingToggleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleBackgroundPress(locationX: number) {
    const now = Date.now();
    const prev = lastTapRef.current;

    if (now - prev.time < DOUBLE_TAP_MS) {
      // Double tap — cancel pending toggle and seek
      if (pendingToggleRef.current) {
        clearTimeout(pendingToggleRef.current);
        pendingToggleRef.current = null;
      }
      lastTapRef.current = { time: 0, x: 0 };
      if (locationX < screenWidth / 2) {
        onSkipBackward();
      } else {
        onSkipForward();
      }
      handleInteraction();
    } else {
      // First tap — wait for potential second tap before toggling
      lastTapRef.current = { time: now, x: locationX };
      pendingToggleRef.current = setTimeout(() => {
        pendingToggleRef.current = null;
        handleToggle();
      }, DOUBLE_TAP_MS);
    }
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
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
          {/* Background tap target — behind buttons */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={(e) => handleBackgroundPress(e.nativeEvent.locationX)}
          />

          {/* ── Top row: back + title ──────────────────────────────── */}
          <View style={styles.topRow} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close player"
              onPress={onDismiss}
              hitSlop={12}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            >
              <Text style={styles.iconText}>{"‹"}</Text>
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
                <Text style={styles.trackBtnText}>CC</Text>
              </Pressable>
            ) : null}
          </View>

          {/* ── Center: play/pause + skip ──────────────────────────── */}
          <View style={styles.centerRow} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip back 10 seconds"
              onPress={() => {
                onSkipBackward();
                handleInteraction();
              }}
              hitSlop={16}
              style={({ pressed }) => [styles.centerBtn, pressed && styles.centerBtnPressed]}
            >
              <Text style={styles.skipText}>-10</Text>
            </Pressable>

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
              <Text style={styles.playIcon}>{isPlaying ? "❚❚" : "▶"}</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip forward 10 seconds"
              onPress={() => {
                onSkipForward();
                handleInteraction();
              }}
              hitSlop={16}
              style={({ pressed }) => [styles.centerBtn, pressed && styles.centerBtnPressed]}
            >
              <Text style={styles.skipText}>+10</Text>
            </Pressable>
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

      {/* ── Tap target when controls hidden ────────────────────────── */}
      {!showControls ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(e) => handleBackgroundPress(e.nativeEvent.locationX)}
        />
      ) : null}
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
  iconText: {
    color: colors.textPrimary,
    fontSize: 32,
    fontWeight: fontWeight.bold,
    lineHeight: 36,
  },
  titleBlock: {
    flex: 1,
  },
  trackBtnText: {
    color: colors.textPrimary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.bodyLarge,
    fontWeight: fontWeight.semibold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  centerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxl,
  },
  centerBtn: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: withAlpha(colors.white, opacity.alpha10),
    alignItems: "center",
    justifyContent: "center",
  },
  centerBtnPressed: {
    opacity: opacity.pressed,
  },
  skipText: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: withAlpha(colors.white, opacity.alpha15),
    alignItems: "center",
    justifyContent: "center",
  },
  playBtnPressed: {
    opacity: opacity.pressed,
  },
  playIcon: {
    color: colors.textPrimary,
    fontSize: 28,
  },
  bottomRow: {
    gap: spacing.sm,
  },
});
