import type { MediaRequest } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenHeader } from "@/features/common/components/screen-header";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { RequestRow } from "@/features/requests/components/request-row";
import { useAuth } from "@/services/auth/state";
import { useDownloadProgressMap, useJellyseerrRequests } from "@/services/query/hooks/use-requests";

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<MediaRequest>);

const BLUR_FADE_END = 60;

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

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
    },
  });
  const blurBackdropStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: interpolate(scrollY.value, [0, BLUR_FADE_END], [0, 1], Extrapolation.CLAMP),
    };
  });

  const [headerHeight, setHeaderHeight] = useState(0);
  function handleHeaderHeightChange(next: number) {
    if (Math.abs(next - headerHeight) > 0.5) {
      setHeaderHeight(next);
    }
  }

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
          backdropStyle={blurBackdropStyle}
          onTotalHeightChange={handleHeaderHeightChange}
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
                <Text style={styles.emptyTitle}>Couldn't load requests</Text>
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
        backdropStyle={blurBackdropStyle}
        onTotalHeightChange={handleHeaderHeightChange}
      />
      <StatusBarScrim />
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Row tap — TMDB-only detail route lands in a later phase. For now
// an `available` request routes home (where the user can find it
// via search / shelves), and the other statuses silently no-op so
// the row still feels tappable in the interim.
// ──────────────────────────────────────────────────────────────────────

function handleRowPress(request: MediaRequest) {
  // TMDB-only detail route lands in a later phase. For now, if the
  // media is already available, route to the Jellyfin-side detail.
  // Otherwise we silently no-op so the row still feels tappable.
  if (request.status === "available") {
    // We don't have the Jellyfin id at this point (only tmdb),
    // so bounce to search with the title pre-filled. Cheap and
    // predictable until the TMDB detail screen exists.
    router.push("/");
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
