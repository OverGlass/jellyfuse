import type { MediaItem } from "@jellyfuse/api";
import { mediaItemSubtitle } from "@jellyfuse/models";
import { colors, duration, fontSize, fontWeight, radius, spacing } from "@jellyfuse/theme";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { useBreakpoint, useScreenGutters } from "@/services/responsive";

/**
 * Detail screen hero — blurred backdrop tint, poster + title block
 * overlaid on top, year / runtime / genres row. Pure component, takes
 * a `MediaItem` and nothing else. Responsive via `useBreakpoint`:
 * phone is a vertical stack, tablet/desktop put the poster beside the
 * title block.
 */
interface Props {
  item: MediaItem;
}

const HERO_BACKDROP_HEIGHT_PHONE = 280;
const HERO_BACKDROP_HEIGHT_TABLET = 360;

export function DetailHero({ item }: Props) {
  const { breakpoint, values } = useBreakpoint();
  const gutters = useScreenGutters();
  const isCompact = breakpoint === "phone";
  const backdropHeight = isCompact ? HERO_BACKDROP_HEIGHT_PHONE : HERO_BACKDROP_HEIGHT_TABLET;
  const posterWidth = isCompact ? 120 : values.mediaCardWidth;
  const posterHeight = isCompact ? 180 : values.mediaCardPosterHeight;
  const subtitle = mediaItemSubtitle(item);

  return (
    <View style={styles.root}>
      {item.backdropUrl ? (
        <Image
          source={item.backdropUrl}
          style={[styles.backdrop, { height: backdropHeight }]}
          contentFit="cover"
          transition={duration.normal}
          recyclingKey={item.backdropUrl}
          cachePolicy="memory-disk"
        />
      ) : (
        <View style={[styles.backdrop, styles.backdropFallback, { height: backdropHeight }]} />
      )}
      <View style={[styles.scrim, { height: backdropHeight }]} />
      <View
        style={[
          styles.contentRow,
          isCompact ? styles.contentRowCompact : styles.contentRowWide,
          { paddingLeft: gutters.left, paddingRight: gutters.right },
        ]}
      >
        {item.posterUrl ? (
          <Image
            source={item.posterUrl}
            style={[styles.poster, { width: posterWidth, height: posterHeight }]}
            contentFit="cover"
            transition={duration.normal}
            recyclingKey={item.posterUrl}
            cachePolicy="memory-disk"
          />
        ) : (
          <View style={[styles.posterFallback, { width: posterWidth, height: posterHeight }]}>
            <Text style={styles.posterFallbackGlyph}>{item.title.slice(0, 1).toUpperCase()}</Text>
          </View>
        )}
        <View style={[styles.titleBlock, isCompact && styles.titleBlockCompact]}>
          <Text style={styles.title} numberOfLines={3}>
            {item.title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          {item.genres.length > 0 ? (
            <Text style={styles.genres} numberOfLines={1}>
              {item.genres.slice(0, 3).join(" · ")}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    position: "relative",
  },
  backdrop: {
    width: "100%",
  },
  backdropFallback: {
    backgroundColor: colors.surface,
  },
  scrim: {
    backgroundColor: colors.background,
    bottom: 0,
    left: 0,
    opacity: 0.55,
    position: "absolute",
    right: 0,
  },
  contentRow: {
    alignItems: "flex-end",
    bottom: spacing.lg,
    left: 0,
    position: "absolute",
    right: 0,
  },
  contentRowCompact: {
    flexDirection: "column",
    alignItems: "flex-start",
  },
  contentRowWide: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  poster: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  posterFallback: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    justifyContent: "center",
  },
  posterFallbackGlyph: {
    color: colors.textMuted,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
  },
  titleBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  titleBlockCompact: {
    marginTop: spacing.md,
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
