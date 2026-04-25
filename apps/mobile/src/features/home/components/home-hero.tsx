import type { MediaItem } from "@jellyfuse/api";
import { episodeLabel } from "@jellyfuse/models";
import { colors, duration, fontSize, fontWeight, spacing, withAlpha } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { ProgressButton } from "@/features/common/components/progress-button";

interface Props {
  item: MediaItem;
  height: number;
  paddingHorizontal: number;
  topInset: number;
  /** Compact title size for portrait (~44/800), wide for landscape (~56/800). */
  density: "compact" | "wide";
  /**
   * Reanimated SharedValue tracking the parent ScrollView's contentOffset.y.
   * When present, the backdrop scales up on negative scroll (iOS bounce pull-
   * down) so it fills the pull-open gap above the hero — same parallax
   * treatment as the detail-screen hero.
   */
  scrollY?: SharedValue<number>;
  onPressResume: (item: MediaItem) => void;
  onPressOpen: (item: MediaItem) => void;
}

/**
 * Cinematic full-bleed hero for the iPad home screen. Promotes the
 * top Continue Watching item over the rest of the shelves. No new
 * functionality — the Resume button reuses `ProgressButton` and routes
 * through the same handler the Continue Watching shelf uses on phone;
 * tapping the hero opens detail. Renders nothing on the phone breakpoint
 * (parent gates by `useBreakpoint()`).
 */
export function HomeHero({
  item,
  height,
  paddingHorizontal,
  topInset,
  density,
  scrollY,
  onPressResume,
  onPressOpen,
}: Props) {
  const { t } = useTranslation();
  const title = item.seriesName ?? item.title;
  // Only show the episode label as a subtitle (e.g. "S2 · E4 – Title");
  // year alone would duplicate what's already in the meta row below.
  const subtitle = episodeLabel(item);
  const meta = buildMeta(item);
  const progress = item.progress ?? 0;
  const titleSize = density === "wide" ? 56 : 44;

  // Pull-to-stretch parallax. Mirrors `detail-hero.tsx` — when the
  // parent scroll bounces past the top, scale the backdrop layer from
  // its bottom edge so the growth fills the pulled-open gap above.
  const stretchStyle = useAnimatedStyle(() => {
    "worklet";
    const y = scrollY?.value ?? 0;
    const pulled = y < 0 ? -y : 0;
    const scale = (height + pulled) / height;
    return { transform: [{ scale }] };
  });

  return (
    <View style={[styles.root, { height }]}>
      <Animated.View style={[styles.stretchLayer, stretchStyle]}>
        {item.backdropUrl ? (
          <Image
            source={item.backdropUrl}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={duration.normal}
            recyclingKey={item.backdropUrl}
            cachePolicy="memory-disk"
            priority="high"
          />
        ) : (
          <LinearGradient
            colors={["#5b3a2c", "#2a1810", colors.border]}
            locations={[0, 0.6, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
      </Animated.View>

      {/* Linear mask: fully transparent at the top so the backdrop reads
          clean (and any stretch on overdrag isn't darkened by an overlay),
          ramping to opaque at the bottom for text legibility. */}
      <LinearGradient
        colors={[
          withAlpha(colors.background, 0),
          withAlpha(colors.background, 0),
          withAlpha(colors.background, 0.85),
          colors.background,
        ]}
        locations={[0, 0.45, 0.9, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={() => onPressOpen(item)}
        style={[
          styles.textBlock,
          {
            paddingHorizontal,
            paddingTop: topInset,
            paddingBottom: spacing.xl,
          },
        ]}
      >
        <Text style={styles.eyebrow}>{t("home.hero.eyebrow")}</Text>
        <Text
          style={[
            styles.title,
            { fontSize: titleSize, lineHeight: titleSize * 1.0, letterSpacing: -titleSize * 0.02 },
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {item.overview ? (
          <Text style={styles.overview} numberOfLines={2}>
            {item.overview}
          </Text>
        ) : null}
        <View style={styles.actionRow}>
          <View style={styles.resumeWrap}>
            <ProgressButton
              label={progress > 0.01 ? t("home.hero.resume") : t("home.hero.play")}
              progress={progress}
              onPress={() => onPressResume(item)}
              height={56}
            />
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function buildMeta(item: MediaItem): string | undefined {
  const parts: string[] = [];
  if (item.rating !== undefined) parts.push(`★ ${item.rating.toFixed(1)}`);
  if (item.year !== undefined) parts.push(String(item.year));
  if (item.runtimeMinutes !== undefined) parts.push(`${item.runtimeMinutes}m`);
  if (item.genres.length > 0) parts.push(item.genres.slice(0, 3).join(" · "));
  return parts.length > 0 ? parts.join("  ·  ") : undefined;
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
    // overflow visible so the stretched backdrop can bleed up above the
    // hero's origin during the iOS bounce pull-down. Matches detail-hero.
    overflow: "visible",
    backgroundColor: colors.border,
    position: "relative",
  },
  stretchLayer: {
    ...StyleSheet.absoluteFillObject,
    // Scale from the bottom so the growth spills UPWARD to fill the
    // pull-down gap above the hero. Matches detail-hero.
    transformOrigin: "bottom",
  },
  textBlock: {
    flex: 1,
    justifyContent: "flex-end",
    maxWidth: 720,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.96,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    marginTop: spacing.sm,
  },
  meta: {
    color: colors.textSecondary,
    fontSize: fontSize.caption + 1,
    marginTop: spacing.xs,
  },
  overview: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: fontSize.body * 1.55,
    marginTop: spacing.md,
    maxWidth: 540,
  },
  actionRow: {
    flexDirection: "row",
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  resumeWrap: { minWidth: 220 },
});
