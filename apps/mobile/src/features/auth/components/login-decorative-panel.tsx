import {
  colors,
  fontSize,
  fontWeight,
  profilePalette,
  radius,
  spacing,
  withAlpha,
} from "@jellyfuse/theme";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

const POSTER_W = 130;
const POSTER_H = 195;
const POSTER_GAP = 14;
const COLUMNS = 8;
const ROWS = 6;

/**
 * Decorative left-hand panel for the iPad split sign-in screen.
 * Renders a slightly tilted poster wall using gradient placeholders
 * sourced from the existing `profilePalette` hues so the wall reads
 * like a real library without introducing new art assets. Pure visual:
 * `pointerEvents="none"` on the rotated grid, no interactive surface.
 */
export function LoginDecorativePanel() {
  const { t } = useTranslation();
  const total = COLUMNS * ROWS;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[withAlpha(colors.accent, 0.18), withAlpha("#c678dd", 0.12), colors.background]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.tiltWrap} pointerEvents="none">
        <View style={styles.grid}>
          {Array.from({ length: total }).map((_, idx) => {
            const hue = profilePalette[idx % profilePalette.length] ?? colors.surface;
            const hueDim =
              profilePalette[(idx + 3) % profilePalette.length] ?? colors.surfaceElevated;
            return (
              <LinearGradient
                key={idx}
                colors={[withAlpha(hue, 0.55), withAlpha(hueDim, 0.25)]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.poster}
              />
            );
          })}
        </View>
      </View>

      <LinearGradient
        colors={[
          withAlpha(colors.background, 0.1),
          withAlpha(colors.background, 0),
          withAlpha(colors.background, 0.7),
          colors.background,
        ]}
        locations={[0, 0.35, 0.85, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.brand}>
        <View style={styles.logoMark}>
          <Text style={styles.logoLetter}>J</Text>
        </View>
        <Text style={styles.wordmark}>{t("auth.login.wordmark")}</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.tagline}>{t("auth.login.tagline")}</Text>
        <Text style={styles.taglineBody}>{t("auth.login.taglineBody")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: "hidden",
    justifyContent: "space-between",
    padding: 56,
  },
  tiltWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-8deg" }, { scale: 1.4 }],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: COLUMNS * (POSTER_W + POSTER_GAP),
    gap: POSTER_GAP,
  },
  poster: {
    width: POSTER_W,
    height: POSTER_H,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  logoMark: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  logoLetter: {
    color: colors.accentContrast,
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
  },
  wordmark: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.bold,
  },
  footer: {
    maxWidth: 380,
    gap: spacing.sm,
  },
  tagline: {
    color: colors.textPrimary,
    fontSize: 36,
    fontWeight: fontWeight.bold,
    lineHeight: 40,
  },
  taglineBody: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: fontSize.body * 1.5,
  },
});
