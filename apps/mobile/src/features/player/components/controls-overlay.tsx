// Full-screen player controls overlay. Auto-hides after 3s of
// inactivity while playing. Tap anywhere to toggle. Uses safe area
// insets so controls avoid the notch / Dynamic Island / home indicator.
// Pure component — props in / callbacks out.
//
// Visibility is DERIVED, not synced:
//   showControls = !userDismissed || !isPlaying
// When paused → always visible. No useEffect for state derivation.
//
// Uses <Activity> to keep the overlay mounted when hidden (preserves
// timer refs, gesture state, layout). Opacity animated manually via
// useAnimatedStyle (Reanimated entering/exiting only fires on
// mount/unmount which Activity intentionally avoids).

import type { AudioStream, Chapter, SubtitleTrack } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Activity, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlayerScrubber } from "./player-scrubber";

const AUTO_HIDE_MS = 3_000;

interface Props {
  title: string;
  subtitle?: string;
  isPlaying: boolean;
  position: number;
  duration: number;
  chapters?: Chapter[];
  audioStreams?: AudioStream[];
  subtitleTracks?: SubtitleTrack[];
  onPlayPause: () => void;
  onSeek: (seconds: number) => void;
  onSkipForward: () => void;
  onSkipBackward: () => void;
  onDismiss: () => void;
  onSetAudioTrack?: (trackId: number) => void;
  onSetSubtitleTrack?: (trackId: number) => void;
  onDisableSubtitles?: () => void;
}

export function ControlsOverlay({
  title,
  subtitle,
  isPlaying,
  position,
  duration,
  chapters,
  onPlayPause,
  onSeek,
  onSkipForward,
  onSkipBackward,
  onDismiss,
}: Props) {
  const insets = useSafeAreaInsets();
  const [userDismissed, setUserDismissed] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived — no useEffect needed. Paused = always show.
  const showControls = !userDismissed || !isPlaying;

  function scheduleHide() {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setUserDismissed(true), AUTO_HIDE_MS);
  }

  function handleTap() {
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

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={handleTap}>
      <Activity mode={showControls ? "visible" : "hidden"}>
        <Animated.View
          style={[
            styles.overlay,
            {
              paddingTop: Math.max(insets.top, spacing.md),
              paddingBottom: Math.max(insets.bottom, spacing.md),
              paddingLeft: Math.max(insets.left, spacing.lg),
              paddingRight: Math.max(insets.right, spacing.lg),
              // Reanimated 4 CSS transitions — no shared values needed
              opacity: showControls ? 1 : 0,
              pointerEvents: showControls ? "auto" : "none",
              transitionProperty: "opacity",
              transitionDuration: 200,
            },
          ]}
        >
          {/* ── Top row: back + title ──────────────────────────────── */}
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close player"
              onPress={onDismiss}
              hitSlop={12}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
            >
              <Text style={styles.iconText}>{"‹"}</Text>
            </Pressable>
            <View style={styles.titleBlock}>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
            </View>
          </View>

          {/* ── Center: play/pause + skip ──────────────────────────── */}
          <View style={styles.centerRow}>
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
          <View style={styles.bottomRow}>
            <PlayerScrubber
              position={position}
              duration={duration}
              chapters={chapters}
              onSeek={(s) => {
                onSeek(s);
                handleInteraction();
              }}
            />
          </View>
        </Animated.View>
      </Activity>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
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
    backgroundColor: "rgba(255,255,255,0.1)",
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
    backgroundColor: "rgba(255,255,255,0.15)",
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
