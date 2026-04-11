import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { StyleSheet, Text, View } from "react-native";
import { MediaCard, MEDIA_CARD_TOTAL_HEIGHT } from "./media-card";
import type { MockMediaItem } from "@/features/home/mock-shelves";

/**
 * Horizontal poster shelf. Pure component: takes a title + items + an
 * `onItemPress` callback, emits no events internally, owns no state.
 *
 * Uses FlashList v2 per CLAUDE.md's "FlashList for every scrollable list"
 * rule. The explicit `MEDIA_CARD_WIDTH` + height constants in the item
 * component let FlashList estimate item size accurately from day 1.
 */

interface Props {
  title: string;
  items: MockMediaItem[];
  onItemPress: (item: MockMediaItem) => void;
}

export function MediaShelf({ title, items, onItemPress }: Props) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <FlashList
        horizontal
        data={items}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <MediaCard
            title={item.title}
            year={item.year}
            posterUrl={item.posterUrl}
            onPress={() => onItemPress(item)}
          />
        )}
      />
    </View>
  );
}

export const MEDIA_SHELF_HEIGHT = MEDIA_CARD_TOTAL_HEIGHT + 40;

const styles = StyleSheet.create({
  root: {
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
  },
});
