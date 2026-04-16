import { colors, fontSize, layout, spacing } from "@jellyfuse/theme";
import { router } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { BackButton } from "@/features/common/components/back-button";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { DetailActionRow } from "@/features/detail/components/detail-action-row";
import { DetailHero } from "@/features/detail/components/detail-hero";
import { DetailMetaRow } from "@/features/detail/components/detail-meta-row";
import { DownloadButton } from "@/features/downloads/components/download-button";
import { useDownloadForItem } from "@/services/downloads/use-local-downloads";
import { useItemDownload } from "@/services/downloads/use-item-download";
import { useMovieDetail } from "@/services/query";
import { useScreenGutters } from "@/services/responsive";

/**
 * Movie detail screen. Prefetches the player route so tapping Play
 * opens instantly (screen rendered off-screen, React Query hooks
 * already fired). Download / Request placeholders land in Phase 5/4.
 */
interface Props {
  itemId: string;
}

export function MovieDetailScreen({ itemId }: Props) {
  const query = useMovieDetail(itemId);
  const downloadRecord = useDownloadForItem(itemId);
  const handleItemDownload = useItemDownload();

  const gutters = useScreenGutters();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  function handleDownloadPress() {
    if (!query.data) return;
    void handleItemDownload(query.data, downloadRecord);
  }

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
          <Text style={styles.errorTitle}>Couldn&apos;t load this title</Text>
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
    <SafeAreaView style={styles.safe} edges={[]}>
      <Animated.ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + layout.screenPaddingBottom },
        ]}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        <DetailHero item={item} scrollY={scrollY} />
        <View style={[styles.body, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
          <DetailMetaRow item={item} />
          <DetailActionRow
            hasResume={hasResume}
            onPlay={() => router.push(`/player/${itemId}`)}
            onDownload={handleDownloadPress}
            downloadSlot={<DownloadButton record={downloadRecord} onPress={handleDownloadPress} />}
          />
          {item.overview ? <Text style={styles.overview}>{item.overview}</Text> : null}
        </View>
      </Animated.ScrollView>
      <StatusBarScrim />
      <BackButton />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    // paddingBottom is merged in at the call site from
    // `insets.bottom + layout.screenPaddingBottom` so the safe-area
    // inset is part of scrollable content (scrolls past the home
    // indicator) rather than fixed shell padding.
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
