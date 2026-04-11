import { useBreakpoint } from "@/services/responsive";
import type { MediaItem } from "@jellyfuse/api";
import { episodeLabel } from "@jellyfuse/models";
import { colors, duration, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import MaskedView from "@react-native-masked-view/masked-view";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

/**
 * Detail screen hero. Backdrop fills 65% of the screen (phone) with
 * the title logo centered in the lower third, matching the Infuse
 * reference design. Year / runtime / genres live in the body section
 * below the hero, not inside it, so the hero is purely about branding.
 *
 * **Never** shows the poster — the hero is about the backdrop image
 * and the title logo, both of which dominate. Repeating the poster
 * inline wastes vertical space and feels redundant next to the shelves
 * the user just came from.
 *
 * Responsive: hero height is a percentage of the window viewport so it
 * scales on every form factor (iPhone portrait → iPad landscape →
 * Catalyst window) without hard-coded breakpoints. The 16:9 backdrop
 * naturally grows with the window.
 *
 * **Parallax stretch**: when the parent scroll view is pulled past
 * the top (iOS bounce / overscroll), the backdrop scales up around
 * its bottom edge to fill the pulled-open space. Matches the classic
 * iOS "stretchy header" pattern. The caller passes a reanimated
 * SharedValue tracking `contentOffset.y` and we apply the transform
 * inside `useAnimatedStyle` so it runs on the UI thread and stays
 * at 60 fps during the bounce.
 */
interface Props {
  item: MediaItem;
  /**
   * For series: the episode the user would resume/start if they tap
   * Play. Rendered as `"S1 · E6 – Excessive Force"` directly beneath
   * the title logo so the hero doubles as a "what's next" indicator,
   * matching the Infuse reference. Omit for movies.
   */
  resumeTarget?: MediaItem;
  scrollY?: SharedValue<number>;
}

/**
 * Hero takes a fraction of the window height so it dominates the
 * viewport on first load, like Infuse / the Apple TV app. Capped to a
 * max so it doesn't swallow the entire tablet/desktop screen.
 */
const HERO_HEIGHT_FRACTION = 0.65;
const HERO_HEIGHT_MAX = 780;

export function DetailHero({ item, resumeTarget, scrollY }: Props) {
  const { breakpoint } = useBreakpoint();
  const { height: windowHeight } = useWindowDimensions();
  const height = Math.min(windowHeight * HERO_HEIGHT_FRACTION, HERO_HEIGHT_MAX);

  // Logo is proportional to the hero height so a taller hero on
  // tablet/desktop gets a larger logo without extra conditionals.
  const logoHeight = breakpoint === "phone" ? 110 : breakpoint === "tablet" ? 140 : 170;

  const resumeLabel = resumeTarget ? buildResumeLabel(resumeTarget) : undefined;

  const stretchStyle = useAnimatedStyle(() => {
    "worklet";
    const y = scrollY?.value ?? 0;
    // Only grow when the user pulls past the top (iOS bounce). Positive
    // scroll = scrolled down into the body = no stretch.
    const pulled = y < 0 ? -y : 0;
    const scale = (height + pulled) / height;
    return {
      transform: [{ scale }],
    };
  });

  return (
    <View style={[styles.root, { height }]}>
      {/* Backdrop wrapped in an Animated view for the pull-to-stretch
          parallax effect, then a MaskedView with a linear-gradient
          alpha mask so the image itself fades into the page background
          at the bottom — the page colour shows through the alpha
          channel instead of being overlaid with a dark scrim. */}
      <Animated.View style={[styles.stretchLayer, stretchStyle]}>
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <LinearGradient
              colors={["black", "black", "transparent"]}
              locations={[0, 0.5, 0.95]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          {item.backdropUrl ? (
            <Image
              source={item.backdropUrl}
              style={styles.backdrop}
              contentFit="cover"
              transition={duration.normal}
              recyclingKey={item.backdropUrl}
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.backdrop, styles.backdropFallback]} />
          )}
        </MaskedView>
      </Animated.View>
      {/* The status-bar gradient lives outside the ScrollView (see
          `<StatusBarScrim />` in the parent screen) so it doesn't
          drag down with the pull-to-stretch bounce. */}
      <View style={styles.logoRow}>
        {item.logoUrl ? (
          <Image
            source={item.logoUrl}
            style={[styles.logo, { height: logoHeight }]}
            contentFit="contain"
            transition={duration.normal}
            recyclingKey={item.logoUrl}
            cachePolicy="memory-disk"
          />
        ) : (
          <Text style={styles.title} numberOfLines={3}>
            {item.title}
          </Text>
        )}
        {resumeLabel ? (
          <Text style={styles.resumeLabel} numberOfLines={1}>
            {resumeLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function buildResumeLabel(target: MediaItem): string {
  const ep = episodeLabel(target);
  if (ep && target.title) return `${ep} – ${target.title}`;
  if (ep) return ep;
  return target.title;
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    // overflow visible so the stretched backdrop can bleed up above the
    // hero's origin during the iOS bounce pull-down. The parent screen
    // has `colors.background` underneath so nothing bad shows through.
    overflow: "visible",
    position: "relative",
    width: "100%",
  },
  stretchLayer: {
    ...StyleSheet.absoluteFillObject,
    // Scale from the bottom so the growth spills UPWARD to fill the
    // pull-down gap above the hero. RN 0.76+ supports transformOrigin
    // as a plain style.
    transformOrigin: "bottom",
  },
  backdrop: {
    height: "100%",
    width: "100%",
  },
  backdropFallback: {
    backgroundColor: colors.surface,
  },
  logoRow: {
    alignItems: "center",
    bottom: 0,
    gap: spacing.sm,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
  },
  logo: {
    aspectRatio: 2,
    maxWidth: "80%",
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    textAlign: "center",
  },
  resumeLabel: {
    paddingTop: spacing.sm,
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.semibold,
    textAlign: "center",
  },
});
