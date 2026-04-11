import type { MediaItem } from "@jellyfuse/api";
import { mediaItemSubtitle } from "@jellyfuse/models";
import { colors, fontSize, spacing } from "@jellyfuse/theme";
import { StyleSheet, Text, View } from "react-native";

/**
 * Single-line meta row that sits under the hero on a detail screen.
 * Year / runtime / season count come from `mediaItemSubtitle`, followed
 * by the first three genres. Separated from the hero so the hero is
 * purely about backdrop + logo (Infuse reference).
 */
interface Props {
  item: MediaItem;
}

export function DetailMetaRow({ item }: Props) {
  const subtitle = mediaItemSubtitle(item);
  const genres = item.genres.slice(0, 3).join(" · ");
  return (
    <View style={styles.root}>
      {subtitle ? <Text style={styles.primary}>{subtitle}</Text> : null}
      {genres ? (
        <Text style={styles.secondary} numberOfLines={1}>
          {genres}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    gap: spacing.xs,
  },
  primary: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    textAlign: "center",
  },
  secondary: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    textAlign: "center",
  },
});
