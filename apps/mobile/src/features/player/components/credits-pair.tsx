// Credits-window pair: "Watch Credits" (secondary) + Up Next countdown
// (primary). Mirrors Rust's PlayerView L614–690. Tapping Watch Credits
// latches the credits-path off via store.watchCredits — the user can
// still get the near-end fallback via the second trigger window.

import { episodeLabel, type MediaItem } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, opacity, spacing } from "@jellyfuse/theme";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEndOfEpisode } from "../state/end-of-episode-context";
import { CountdownPill } from "./countdown-pill";

interface Props {
  nextEpisode: MediaItem;
  onAutoplay: () => void;
}

export function CreditsPair({ nextEpisode, onAutoplay }: Props) {
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("player.watchCredits")}
        onPress={store.watchCredits}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryLabel} numberOfLines={1}>
          {t("player.watchCredits")}
        </Text>
      </Pressable>
      <View style={styles.primary}>
        <CountdownPill
          label={upNextLabel}
          onPress={onAutoplay}
          accessibilityLabel={t("player.playNowAriaLabel", { title: nextEpisode.title })}
        />
      </View>
    </View>
  );
}

const PAIR_WIDTH = 320;

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    width: PAIR_WIDTH,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  secondary: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  secondaryLabel: {
    color: colors.accent,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  primary: {
    flex: 1,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
