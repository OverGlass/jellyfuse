import { colors, fontSize, layout, spacing } from "@jellyfuse/theme";
import { router } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DetailActionRow } from "@/features/detail/components/detail-action-row";
import { DetailHero } from "@/features/detail/components/detail-hero";
import { useMovieDetail } from "@/services/query";
import { useBreakpoint } from "@/services/responsive";

/**
 * Read-only movie detail. Fetches `/Users/{uid}/Items/{id}` via
 * `useMovieDetail` and renders hero + overview + action row. Play is
 * a placeholder (console warn) until Phase 3 ships the MPV player;
 * Download / Request placeholders land in Phase 5 / Phase 4.
 */
interface Props {
  itemId: string;
}

export function MovieDetailScreen({ itemId }: Props) {
  const query = useMovieDetail(itemId);
  const { values } = useBreakpoint();

  if (query.isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Couldn't load this title</Text>
          <Text style={styles.errorBody}>
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const item = query.data;
  const hasResume = (item.progress ?? 0) > 0.01;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <DetailHero item={item} />
        <View style={[styles.body, { paddingHorizontal: values.screenPaddingHorizontal }]}>
          <DetailActionRow
            hasResume={hasResume}
            onPlay={() => {
              console.warn(`play movie ${itemId}`);
            }}
            onDownload={() => {
              console.warn(`download movie ${itemId}`);
            }}
          />
          {item.overview ? <Text style={styles.overview}>{item.overview}</Text> : null}
        </View>
      </ScrollView>
      <BackHint />
    </SafeAreaView>
  );
}

function BackHint() {
  // Expo Router's default header is disabled on this screen's stack entry,
  // so `router.canGoBack()` is our only hint that there's somewhere to go.
  return router.canGoBack() ? null : null;
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    paddingBottom: layout.screenPaddingBottom,
  },
  body: {
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  overview: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: 22,
  },
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
  },
  errorBody: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});
