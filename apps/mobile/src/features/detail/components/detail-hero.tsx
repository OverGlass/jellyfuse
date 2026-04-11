import type { MediaItem } from "@jellyfuse/api";
import { mediaItemSubtitle } from "@jellyfuse/models";
import { colors, duration, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import { useBreakpoint, useScreenGutters } from "@/services/responsive";

/**
 * Detail screen hero. Ports the Rust `DetailView::render_hero`:
 * full-width backdrop image under a vertical gradient scrim, with
 * the **title logo** (falling back to the title text) anchored to
 * the bottom-left. Genres + year + runtime render as the subtitle
 * beneath the logo, not as a right column — on mobile there's no
 * room for a two-column hero, so everything stacks left-aligned.
 *
 * **Never** shows the poster here — the hero is about backdrop +
 * branding, and repeating the poster inline wastes vertical space
 * and feels redundant with the shelves the user just came from.
 *
 * Responsive: taller backdrop on tablet/desktop to match the larger
 * viewport; everything else derives from `useScreenGutters()` so the
 * notch in landscape is handled automatically.
 */
interface Props {
  item: MediaItem;
}

const HERO_HEIGHT_PHONE = 320;
const HERO_HEIGHT_TABLET = 440;
const HERO_HEIGHT_DESKTOP = 520;
const LOGO_HEIGHT = 72;

export function DetailHero({ item }: Props) {
  const { breakpoint } = useBreakpoint();
  const gutters = useScreenGutters();
  const height =
    breakpoint === "phone"
      ? HERO_HEIGHT_PHONE
      : breakpoint === "tablet"
        ? HERO_HEIGHT_TABLET
        : HERO_HEIGHT_DESKTOP;
  const subtitle = mediaItemSubtitle(item);

  return (
    <View style={[styles.root, { height }]}>
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
      {/* Bottom scrim — fades the backdrop into the page background so
          the title logo + subtitle + genres stay legible on any image. */}
      <LinearGradient
        pointerEvents="none"
        colors={[
          "rgba(30,34,39,0)",
          "rgba(30,34,39,0.45)",
          "rgba(30,34,39,0.85)",
          colors.background,
        ]}
        locations={[0, 0.45, 0.8, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Top mask — darkens the area under the status bar / notch so the
          status icons + back button stay readable when the backdrop is
          bright. Covers ~statusbar + notch height (120 dp is enough for
          Dynamic Island on iPhone 14/15 Pro). */}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(30,34,39,0.85)", "rgba(30,34,39,0)"]}
        locations={[0, 1]}
        style={styles.topMask}
      />
      <View style={[styles.textBlock, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
        {item.logoUrl ? (
          <Image
            source={item.logoUrl}
            style={styles.logo}
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
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {item.genres.length > 0 ? (
          <Text style={styles.genres} numberOfLines={1}>
            {item.genres.slice(0, 3).join(" · ")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    position: "relative",
    width: "100%",
  },
  backdrop: {
    height: "100%",
    width: "100%",
  },
  backdropFallback: {
    backgroundColor: colors.surface,
  },
  topMask: {
    height: 120,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  textBlock: {
    bottom: spacing.lg,
    gap: spacing.xs,
    left: 0,
    position: "absolute",
    right: 0,
  },
  logo: {
    alignSelf: "flex-start",
    aspectRatio: 3,
    height: LOGO_HEIGHT,
    maxWidth: "75%",
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  genres: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
  },
});
