// Near-end Up Next card. Appears in the final 30–40s of an episode
// when no credits segment is plumbed (or after the user tapped
// "Watch Credits" — the credits-path latches off, this path takes
// over). Tap X to dismiss for the rest of the episode.
//
// The card wrapper (eyebrow + title + button) is a mobile addition
// over Rust's bare button; the surrounding chrome carries the
// episode context so the button itself stays minimal — `Up Next ·
// S01E02`, matching Rust verbatim.

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
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NerdIcon } from "@/features/common/components/nerd-icon";
import { useEndOfEpisode } from "../state/end-of-episode-context";
import { CountdownPill } from "./countdown-pill";

interface Props {
  nextEpisode: MediaItem;
  onAutoplay: () => void;
}

export function NearEndPill({ nextEpisode, onAutoplay }: Props) {
  const { t } = useTranslation();
  const { store } = useEndOfEpisode();
  const insets = useSafeAreaInsets();
  const label = episodeLabel(nextEpisode);
  const upNextLabel = label
    ? t("player.upNextWithEpisode", { episode: label })
    : t("player.upNext");
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
              {t("player.upNext")}
            </Text>
            <Text style={styles.title} numberOfLines={2}>
              {nextEpisode.title}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("player.upNextDismiss")}
            onPress={store.dismiss}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <NerdIcon name="close" size={18} />
          </Pressable>
        </View>
        <CountdownPill
          label={upNextLabel}
          onPress={onAutoplay}
          accessibilityLabel={t("player.playNowAriaLabel", { title: nextEpisode.title })}
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
