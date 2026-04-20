// "Up Next" card — appears in the last 30-40s of an episode when the
// next episode is known. Shows a 10s countdown with a progress bar;
// fires `onAutoplay` automatically on expiry, or immediately if the
// user taps "Play Now". Tap X to dismiss for the rest of this episode.
//
// Ports the fallback near-end path in `PlayerView::render` from
// `crates/jf-ui-kit/src/views/player/mod.rs` (we don't yet plumb the
// credits segment, so the credits-aware variant is skipped — this is
// the unconditional near-end fallback Rust uses when credits data is
// missing or the user dismissed "Watch Credits").
//
// Trigger thresholds mirror the Rust logic exactly:
//   duration ≥ 3000s (50 min) → show at 40s remaining
//   duration ≥ 2400s (40 min) → show at 35s remaining
//   else                     → show at 30s remaining
//   never fires if duration < 600s (10 min) or remaining < 20s.
//
// Countdown is paused while playback is paused, matching Rust's
// `!pv.video.paused()` gate on `up_next_elapsed += TICK_SECS`.

import { episodeLabel, type MediaItem } from "@jellyfuse/models";
import {
  colors,
  fontSize,
  fontWeight,
  opacity,
  radius,
  spacing,
  withAlpha,
} from "@jellyfuse/theme";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAnimatedReaction, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { NerdIcon } from "@/features/common/components/nerd-icon";
import { ProgressButton } from "@/features/common/components/progress-button";

const COUNTDOWN_SECONDS = 10;
const MIN_DURATION = 600; // 10 min — shorter items never get Up Next.
const MIN_REMAINING = 20; // below this we're too close to EOF to matter.
const TICK_MS = 100;

interface Props {
  /** UI-thread position mirror. */
  positionShared: SharedValue<number>;
  /** UI-thread duration mirror. */
  durationShared: SharedValue<number>;
  /** The next episode, or undefined — overlay is a no-op without it. */
  nextEpisode: MediaItem | undefined;
  /** Pauses the countdown when false, matching Rust's paused() gate. */
  isPlaying: boolean;
  /** Fires when the countdown reaches zero or the user taps "Play Now". */
  onAutoplay: () => void;
}

export function UpNextOverlay({
  positionShared,
  durationShared,
  nextEpisode,
  isPlaying,
  onAutoplay,
}: Props) {
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  // Dismissed persists for the life of this player mount — navigating
  // to the next episode remounts the screen and resets it. Reaching the
  // final ~20s also short-circuits the trigger so re-showing on a late
  // scrub-forward isn't an issue.
  const [dismissed, setDismissed] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Watch position on the UI thread — only flip the JS-side `visible`
  // flag when we cross the threshold, so steady-state playback doesn't
  // re-render the overlay. Same pattern as SkipSegmentPill.
  useAnimatedReaction(
    () => {
      const duration = durationShared.value;
      const position = positionShared.value;
      if (duration < MIN_DURATION) return false;
      const remaining = duration - position;
      const showAt = duration >= 3000 ? 40 : duration >= 2400 ? 35 : 30;
      return remaining <= showAt && remaining >= MIN_REMAINING;
    },
    (nearEnd, previous) => {
      if (nearEnd === previous) return;
      scheduleOnRN(setVisible, nearEnd === true);
    },
  );

  const shouldCount = visible && !dismissed && nextEpisode !== undefined && isPlaying;

  // 100 ms-granularity JS timer. Reset elapsed on every show→hide
  // transition so re-entering the window (user scrubs back and forth)
  // doesn't resume mid-countdown. `onAutoplay` is called exactly once
  // per countdown — guarded by clearing the interval before firing.
  useEffect(() => {
    if (!shouldCount) return;
    const id = setInterval(() => {
      setElapsed((e) => {
        const next = e + TICK_MS / 1000;
        if (next >= COUNTDOWN_SECONDS) {
          clearInterval(id);
          onAutoplay();
          return COUNTDOWN_SECONDS;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldCount]); // onAutoplay captured once per visible episode

  // Reset elapsed when the overlay disappears so the next appearance
  // starts fresh. Cheaper than tracking in a ref since `visible`
  // transitions are rare.
  const lastVisibleRef = useRef(false);
  useEffect(() => {
    if (!visible && lastVisibleRef.current) setElapsed(0);
    lastVisibleRef.current = visible;
  }, [visible]);

  if (!visible || !nextEpisode || dismissed) return null;

  const progress = Math.min(1, elapsed / COUNTDOWN_SECONDS);
  const label = episodeLabel(nextEpisode);
  const secondsLeft = Math.max(0, Math.ceil(COUNTDOWN_SECONDS - elapsed));

  return (
    <View
      style={[
        styles.wrapper,
        {
          bottom: Math.max(insets.bottom, spacing.lg) + 80,
          right: Math.max(insets.right, spacing.lg),
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.card} pointerEvents="auto">
        <View style={styles.topRow}>
          <View style={styles.textBlock}>
            <Text style={styles.eyebrow} numberOfLines={1}>
              {label ? `Up Next · ${label}` : "Up Next"}
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {nextEpisode.title}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss Up Next"
            onPress={() => setDismissed(true)}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <NerdIcon name="close" size={18} />
          </Pressable>
        </View>
        {/* Countdown progress is baked into the button itself via
            ProgressButton — no separate track bar. Matches the Rust
            reference `play_button` visual: a pill whose fill advances
            as the countdown runs down. */}
        <ProgressButton
          label={`Play Now (${secondsLeft}s)`}
          progress={progress}
          onPress={onAutoplay}
          accessibilityLabel={`Play ${nextEpisode.title} now`}
        />
      </View>
    </View>
  );
}

const CARD_WIDTH = 280;

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    width: CARD_WIDTH,
  },
  card: {
    // Heavier alpha than `overlay.alpha45` so the card reads clearly
    // against high-luma credit scenes.
    backgroundColor: withAlpha(colors.black, 0.85),
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    overflow: "hidden",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  textBlock: {
    flex: 1,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: withAlpha(colors.white, opacity.alpha15),
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
