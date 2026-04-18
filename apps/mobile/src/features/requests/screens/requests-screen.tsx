import type { MediaRequest } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { ScreenHeader } from "@/features/common/components/screen-header";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { useFloatingHeaderScroll } from "@/features/common/hooks/use-floating-header-scroll";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { RequestRow } from "@/features/requests/components/request-row";
import { useAuth } from "@/services/auth/state";
import { useDownloadProgressMap, useJellyseerrRequests } from "@/services/query/hooks/use-requests";

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<MediaRequest>);

/**
 * Screen listing the active Jellyseerr requests for the signed-in
 * user. Lives at `(app)/requests` and is reached from the home
 * header's "Requests" shortcut (visible only when Jellyseerr is
 * connected). Shares the same visual vocabulary as home + shelf —
 * `ScreenHeader` pinned at the top with an animated blur backdrop
 * driven by a native-driven scroll handler, `showsVerticalScrollIndicator`
 * off, and `contentContainerStyle.paddingTop` tied to the measured
 * header height.
 *
 * Data:
 * - `useJellyseerrRequests()` pulls the list + refetches every 15s.
 * - `useDownloadProgressMap(requests)` fans per-item progress polls
 *   across every pending / approved TMDB id every 10s and returns a
 *   `Map<tmdbId, DownloadProgress>`. The row component reads the
 *   map by TMDB id — items without a queue entry just render
 *   without a progress bar.
 *
 * States rendered inline in the ListHeader:
 * - Jellyseerr not connected → empty state with the reconnect hint.
 * - Still loading the first page → spinner.
 * - HTTP error → inline error row.
 * - Empty list → friendly zero-state pointing at search.
 */
export function RequestsScreen() {
  const insets = useSafeAreaInsets();
  const { jellyseerrStatus } = useAuth();
  const requestsQuery = useJellyseerrRequests();
  const requests = requestsQuery.data ?? [];
  const { map: progressMap } = useDownloadProgressMap(requests);
  const { headerHeight, onHeaderHeightChange, scrollY, backdropStyle } = useFloatingHeaderScroll();
  const scrollRestore = useRestoredScroll("/requests");
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
      scheduleOnRN(scrollRestore.setOffset, event.contentOffset.y);
    },
  });

  if (jellyseerrStatus !== "connected") {
    return (
      <View style={styles.root}>
        <View style={[styles.centered, { paddingTop: headerHeight + spacing.xxl }]}>
          <Text style={styles.emptyTitle}>Jellyseerr not connected</Text>
          <Text style={styles.emptyBody}>
            Sign in to Jellyseerr from the auth flow to see your media requests here.
          </Text>
        </View>
        <ScreenHeader
          showBack
          title="Requests"
          backdropStyle={backdropStyle}
          onTotalHeightChange={onHeaderHeightChange}
        />
        <StatusBarScrim />
      </View>
    );
  }

  const isInitialLoading = requestsQuery.isPending;
  const hasError = requestsQuery.isError;
  const isEmpty = !isInitialLoading && !hasError && requests.length === 0;

  return (
    <View style={styles.root}>
      <AnimatedFlashList
        ref={scrollRestore.ref}
        onContentSizeChange={scrollRestore.onContentSizeChange}
        data={requests}
        keyExtractor={(request) => `request-${request.id}`}
        contentContainerStyle={{
          paddingTop: headerHeight + spacing.md,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View>
            {isInitialLoading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.textSecondary} />
              </View>
            ) : null}
            {hasError ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>Couldn&apos;t load requests</Text>
                <Text style={styles.emptyBody}>
                  {requestsQuery.error instanceof Error
                    ? requestsQuery.error.message
                    : "Unknown error"}
                </Text>
              </View>
            ) : null}
            {isEmpty ? (
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>No requests yet</Text>
                <Text style={styles.emptyBody}>
                  Search for a movie or show and tap the Request badge to kick one off.
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <RequestRow
            request={item}
            progress={progressMap.get(item.tmdbId)}
            onPress={() => handleRowPress(item)}
          />
        )}
      />
      <ScreenHeader
        showBack
        title="Requests"
        backdropStyle={backdropStyle}
        onTotalHeightChange={onHeaderHeightChange}
      />
      <StatusBarScrim />
    </View>
  );
}

/**
 * Navigate on row tap — mirrors the Rust `detail_path()` rule:
 *   - `MediaId::Both`   → Jellyfin detail (prefer library when available)
 *   - `MediaId::Tmdb`   → TMDB/Jellyseerr detail
 *
 * `jellyfinMediaId` is populated by the enrichment step in
 * `fetchJellyseerrRequests` when Jellyseerr reports the item as
 * available (status 5) and has synced the Jellyfin ID into its
 * `mediaInfo`. When absent we fall back to the TMDB detail screen.
 */
function handleRowPress(request: MediaRequest) {
  if (request.jellyfinMediaId) {
    const pathname =
      request.mediaType === "tv" ? "/detail/series/[jellyfinId]" : "/detail/movie/[jellyfinId]";
    router.push({ pathname, params: { jellyfinId: request.jellyfinMediaId } });
  } else {
    router.push({
      pathname: "/detail/tmdb/[tmdbId]",
      params: { tmdbId: String(request.tmdbId), mediaType: request.mediaType },
    });
  }
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  centered: {
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.semibold,
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});
