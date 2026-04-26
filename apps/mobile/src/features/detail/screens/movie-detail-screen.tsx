import { colors, fontSize, layout, spacing } from "@jellyfuse/theme";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { BackButton } from "@/features/common/components/back-button";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { DetailActionRow } from "@/features/detail/components/detail-action-row";
import { DetailHero } from "@/features/detail/components/detail-hero";
import { DetailMetaRow } from "@/features/detail/components/detail-meta-row";
import { DownloadButton } from "@/features/downloads/components/download-button";
import { useConnectionStatus } from "@/services/connection/monitor";
import { useDownloadForItem } from "@/services/downloads/use-local-downloads";
import { useItemDownload } from "@/services/downloads/use-item-download";
import { useMovieDetail } from "@/services/query";
import { useTogglePlayedState } from "@/services/query/hooks/use-played-state";
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
  const { t } = useTranslation();
  const query = useMovieDetail(itemId);
  const downloadRecord = useDownloadForItem(itemId);
  const handleItemDownload = useItemDownload();
  const togglePlayed = useTogglePlayedState();
  const connection = useConnectionStatus();
  // Local-first policy mirrors `PlayerScreen` (see
  // `player-screen.tsx` — originals always local, transcodes only
  // when offline). When offline without a local copy, Play is
  // disabled. New downloads can't be enqueued offline either.
  const hasLocal =
    downloadRecord?.state === "done" && (downloadRecord.wasOriginal || connection === "offline");
  const canPlay = connection !== "offline" || hasLocal;
  const canDownload = connection !== "offline";

  const gutters = useScreenGutters();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const scrollRestore = useRestoredScroll(`/detail/movie/${itemId}`);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
      scheduleOnRN(scrollRestore.setOffset, event.contentOffset.y);
    },
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
          <Text style={styles.errorTitle}>{t("detail.error.movieTitle")}</Text>
          <Text style={styles.errorBody}>
            {query.error instanceof Error ? query.error.message : t("detail.error.unknown")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const item = query.data;
  const hasResume = (item.progress ?? 0) > 0.01;
  const played = item.userData?.played ?? false;

  return (
    <SafeAreaView style={styles.safe} edges={[]}>
      <Animated.ScrollView
        ref={scrollRestore.ref}
        onContentSizeChange={scrollRestore.onContentSizeChange}
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
            resumeProgress={item.progress ?? 0}
            canPlay={canPlay}
            onPlay={() => router.push(`/player/${itemId}`)}
            onDownload={handleDownloadPress}
            downloadSlot={
              <DownloadButton
                record={downloadRecord}
                onPress={handleDownloadPress}
                disabled={!canDownload}
              />
            }
            played={played}
            onTogglePlayed={() => togglePlayed.mutate({ itemId, next: !played })}
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
