import type { MediaItem } from "@jellyfuse/api";
import type { DownloadRecord } from "@jellyfuse/models";
import { colors, fontSize, layout, spacing } from "@jellyfuse/theme";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { BackButton } from "@/features/common/components/back-button";
import { FloatingBlurHeader } from "@/features/common/components/floating-blur-header";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { DetailActionRow } from "@/features/detail/components/detail-action-row";
import { DetailMetaRow } from "@/features/detail/components/detail-meta-row";
import { DetailHero } from "@/features/detail/components/detail-hero";
import { EpisodeRow } from "@/features/detail/components/episode-row";
import { SeasonTabs } from "@/features/detail/components/season-tabs";
import { DownloadButton } from "@/features/downloads/components/download-button";
import { useConnectionStatus } from "@/services/connection/monitor";
import { useItemDownload } from "@/services/downloads/use-item-download";
import { useLocalDownloads } from "@/services/downloads/use-local-downloads";
import { useEpisodes, useSeasons, useSeriesDetail } from "@/services/query";
import { useScreenGutters } from "@/services/responsive";

/**
 * Read-only series detail. Renders the shared hero + action row, then
 * horizontal season tabs, then the episode list for the active season.
 * Three queries flow through here (`useSeriesDetail`, `useSeasons`,
 * `useEpisodes`), the episode query only firing after the season tabs
 * pick an active season. Each React Query hook is scoped by userId,
 * so nothing leaks across user switches.
 *
 * Active season state is held in local `useState` per CLAUDE.md's
 * "UI-only state" rule — it doesn't mirror server state, it picks
 * which one is visible.
 */
interface Props {
  itemId: string;
}

// Estimated height of one `<EpisodeRow>` (thumbnail 80 + vertical
// padding + ~3 lines of overview). Used as a lower bound for the
// episode list container's `minHeight` so switching to a shorter
// season doesn't reflow the page. Close enough; real heights are
// measured via onLayout and the max is remembered below.
const ESTIMATED_EPISODE_ROW_HEIGHT = 110;

export function SeriesDetailScreen({ itemId }: Props) {
  const seriesQuery = useSeriesDetail(itemId);
  const seasonsQuery = useSeasons(itemId);

  const [activeSeasonId, setActiveSeasonId] = useState<string | undefined>(undefined);
  const resolvedActiveSeasonId = activeSeasonId ?? defaultSeasonId(seasonsQuery.data);

  const episodesQuery = useEpisodes(itemId, resolvedActiveSeasonId);
  const downloads = useLocalDownloads();
  const handleItemDownload = useItemDownload();
  const connection = useConnectionStatus();
  const isOffline = connection === "offline";
  const gutters = useScreenGutters();
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const tabLayoutY = useSharedValue(0);
  const scrollRestore = useRestoredScroll(`/detail/series/${itemId}`);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
      scheduleOnRN(scrollRestore.setOffset, event.contentOffset.y);
    },
  });

  // Remember the tallest episode list height we've seen so far and
  // pin the container to it, so switching to a season with fewer
  // episodes doesn't shrink the page. Grows monotonically.
  const [maxEpisodeListHeight, setMaxEpisodeListHeight] = useState(0);
  const onEpisodeListLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > maxEpisodeListHeight) setMaxEpisodeListHeight(h);
  };

  /**
   * Animated style for the floating sticky-tabs overlay. We don't use
   * `stickyHeaderIndices` because that grows the view in-flow (the
   * inset/clearance padding would be present even before the tabs
   * pin, which looked wrong). Instead we render two copies: the
   * natural tabs inside the ScrollView for layout + scroll anchoring,
   * and a floating overlay (absolutely positioned at the top of the
   * SafeAreaView) that fades + slides in as the natural tabs scroll
   * past the viewport top.
   *
   * Opacity interpolates over a 40 dp transition zone just before
   * `stickPoint` so the overlay smoothly fades in (not a hard
   * snap). translateY starts at -8 and eases to 0 over the same
   * range for a slight vertical nudge that feels like iOS large
   * title → small title. When fully invisible (`opacity < 0.01`)
   * the overlay is parked at translateY: -1000 so it doesn't eat
   * taps.
   */
  const floatingTabsStyle = useAnimatedStyle(() => {
    "worklet";
    const stickPoint = tabLayoutY.value;
    if (stickPoint <= 0) {
      return { opacity: 0, transform: [{ translateY: -1000 }] };
    }
    const progress = interpolate(
      scrollY.value,
      [stickPoint - 40, stickPoint],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const slide = interpolate(
      scrollY.value,
      [stickPoint - 40, stickPoint],
      [-8, 0],
      Extrapolation.CLAMP,
    );
    const parked = progress < 0.01 ? -1000 : slide;
    return {
      opacity: progress,
      transform: [{ translateY: parked }],
    };
  });

  /**
   * Back-button visibility — the inverse of `floatingTabsStyle`.
   * Visible while the hero dominates the viewport (user hasn't
   * scrolled yet), fades out as the floating tabs come in so we
   * never stack both in the top area at the same time.
   */
  const backButtonStyle = useAnimatedStyle(() => {
    "worklet";
    const stickPoint = tabLayoutY.value;
    if (stickPoint <= 0) {
      return { opacity: 1, transform: [{ translateY: 0 }] };
    }
    const progress = interpolate(
      scrollY.value,
      [stickPoint - 40, stickPoint],
      [1, 0],
      Extrapolation.CLAMP,
    );
    return {
      opacity: progress,
      transform: [{ translateY: progress < 0.01 ? -1000 : 0 }],
    };
  });

  const onNaturalTabsLayout = (event: LayoutChangeEvent) => {
    tabLayoutY.value = event.nativeEvent.layout.y;
  };

  if (seriesQuery.isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textSecondary} />
        </View>
      </SafeAreaView>
    );
  }

  if (seriesQuery.isError || !seriesQuery.data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Couldn&apos;t load this series</Text>
          <Text style={styles.errorBody}>
            {seriesQuery.error instanceof Error ? seriesQuery.error.message : "Unknown error"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const series = seriesQuery.data;
  const seasons = seasonsQuery.data ?? [];
  const episodes = episodesQuery.data ?? [];
  const resumeTarget = pickResumeTarget(episodes);
  // hasResume / resumeProgress are per-episode, not series-aggregate.
  // `series.progress` from Jellyfin is the whole-series PlayedPercentage,
  // which is non-zero after a single episode finishes — but that doesn't
  // mean the *next* episode is mid-watch. The button fill + label must
  // reflect the target episode's own playback position, otherwise the
  // resume UX lies (button says "Resume 50%" but tapping it starts
  // episode N from 0, because that's all the server knows about).
  const resumeProgress = resumeTarget?.progress ?? 0;
  const hasResume = resumeProgress > 0.01 && resumeProgress < 0.99;
  const playTarget = resumeTarget ?? episodes[0];
  const playTargetHref = playTarget ? (`/player/${keyFor(playTarget)}` as const) : undefined;
  const playTargetPlayable = playTarget
    ? !isOffline || hasPlayableLocal(downloads, keyFor(playTarget))
    : false;
  const canPlaySeries = !isOffline || playTargetPlayable;

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
        {/* Hero */}
        <DetailHero item={series} resumeTarget={resumeTarget} scrollY={scrollY} />

        {/* Meta row + action row + overview */}
        <View style={[styles.body, { paddingLeft: gutters.left, paddingRight: gutters.right }]}>
          <DetailMetaRow item={series} />
          <DetailActionRow
            hasResume={hasResume}
            resumeProgress={resumeProgress}
            canPlay={canPlaySeries}
            onPlay={() => {
              if (playTargetHref) router.push(playTargetHref);
            }}
          />
          {series.overview ? <Text style={styles.overview}>{series.overview}</Text> : null}
        </View>

        {/* Natural-flow season tabs — no inset or back-button padding.
            Captures the layout Y in a SharedValue so the floating
            overlay below knows when to slide in. */}
        {seasons.length > 0 ? (
          <View
            onLayout={onNaturalTabsLayout}
            style={[styles.naturalTabs, { paddingLeft: gutters.left, paddingRight: gutters.right }]}
          >
            <SeasonTabs
              seasons={seasons}
              activeSeasonId={resolvedActiveSeasonId}
              onSelect={setActiveSeasonId}
            />
          </View>
        ) : null}

        {/* Episode list. The container's `minHeight` is the max
            height we've ever measured plus a rough per-row estimate
            for the tallest declared season, so switching to a
            shorter season doesn't shrink the page. */}
        {seasons.length > 0 ? (
          <View
            onLayout={onEpisodeListLayout}
            style={[
              styles.body,
              {
                paddingLeft: gutters.left,
                paddingRight: gutters.right,
                minHeight: Math.max(
                  maxEpisodeListHeight,
                  maxDeclaredEpisodeCount(seasons) * ESTIMATED_EPISODE_ROW_HEIGHT,
                ),
              },
            ]}
          >
            {episodesQuery.isPending ? <ActivityIndicator color={colors.textSecondary} /> : null}
            {episodes.map((episode) => {
              const episodeId = keyFor(episode);
              const record = pickRecordForItem(downloads, episodeId);
              // While online: any episode is playable (stream from server).
              // Offline: only if a completed local copy exists (transcodes
              // count while offline — the player's local-first policy).
              const episodePlayable = !isOffline || record?.state === "done";
              return (
                <EpisodeRow
                  key={episodeId}
                  item={episode}
                  disabled={!episodePlayable}
                  onPress={() => router.push(`/player/${episodeId}`)}
                  rightSlot={
                    <DownloadButton
                      record={record}
                      size={36}
                      disabled={isOffline}
                      onPress={() => {
                        void handleItemDownload(episode, record);
                      }}
                    />
                  }
                />
              );
            })}
          </View>
        ) : null}
      </Animated.ScrollView>
      {seasons.length > 0 ? (
        <FloatingBlurHeader style={floatingTabsStyle}>
          <View style={{ paddingLeft: gutters.left, paddingRight: gutters.right }}>
            <SeasonTabs
              seasons={seasons}
              activeSeasonId={resolvedActiveSeasonId}
              onSelect={setActiveSeasonId}
            />
          </View>
        </FloatingBlurHeader>
      ) : null}
      <StatusBarScrim />
      {/* Back button is visible at rest (hero view) and fades out as
          the floating tabs fade in. Never stacked with the pinned
          tabs — the two inhabit the top area in alternation. */}
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, backButtonStyle]}>
        <BackButton />
      </Animated.View>
    </SafeAreaView>
  );
}

/**
 * Pick the episode the series "Resume / Play" CTA should point at.
 * Heuristic order: in-progress (0 < progress < 1) → first unplayed →
 * first loaded episode. Good enough for Phase 2d; the Rust
 * `DetailState::play_target()` uses the same ordering.
 */
/**
 * Largest season episode count across all loaded seasons. Used to
 * size the episode list container so switching to a shorter season
 * doesn't reflow the page.
 */
function maxDeclaredEpisodeCount(seasons: MediaItem[]): number {
  let max = 0;
  for (const s of seasons) {
    const n = s.episodeCount ?? 0;
    if (n > max) max = n;
  }
  return max;
}

function pickResumeTarget(episodes: MediaItem[]): MediaItem | undefined {
  if (episodes.length === 0) return undefined;
  const inProgress = episodes.find((e) => {
    const p = e.progress ?? 0;
    return p > 0.01 && p < 0.99;
  });
  if (inProgress) return inProgress;
  const unplayed = episodes.find((e) => !(e.userData?.played ?? false));
  return unplayed ?? episodes[0];
}

function defaultSeasonId(seasons: MediaItem[] | undefined): string | undefined {
  if (!seasons || seasons.length === 0) return undefined;
  // Prefer the lowest season number that is at least 1 (drop Specials
  // if a real Season 1 exists), otherwise return the first entry.
  const sorted = [...seasons].sort(
    (a, b) =>
      (a.seasonNumber ?? Number.MAX_SAFE_INTEGER) - (b.seasonNumber ?? Number.MAX_SAFE_INTEGER),
  );
  const firstRegular = sorted.find((s) => (s.seasonNumber ?? 0) >= 1);
  const pick = firstRegular ?? sorted[0];
  if (!pick) return undefined;
  return keyFor(pick);
}

function keyFor(item: MediaItem): string {
  return item.id.kind === "tmdb" ? `tmdb-${item.id.tmdbId}` : item.id.jellyfinId;
}

/**
 * Pick the most-relevant download record for a given episode itemId.
 * State priority matches `useDownloadForItem`:
 *   downloading > queued > paused > done > failed.
 * Returns undefined when the episode isn't in the downloads list.
 */
const RECORD_PRIORITY: Record<DownloadRecord["state"], number> = {
  downloading: 0,
  queued: 1,
  paused: 2,
  done: 3,
  failed: 4,
};

function pickRecordForItem(records: DownloadRecord[], itemId: string): DownloadRecord | undefined {
  let best: DownloadRecord | undefined;
  for (const r of records) {
    if (r.itemId !== itemId) continue;
    if (!best || RECORD_PRIORITY[r.state] < RECORD_PRIORITY[best.state]) best = r;
  }
  return best;
}

/**
 * True when the item has a completed local download. While offline,
 * transcodes are also eligible (see `PlayerScreen` local-first policy).
 */
function hasPlayableLocal(records: DownloadRecord[], itemId: string): boolean {
  const record = pickRecordForItem(records, itemId);
  return record?.state === "done";
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
  naturalTabs: {
    // in-flow tabs with standard gutter padding — no notch inset,
    // no back-button clearance. The pinned copy lives in
    // <FloatingBlurHeader>, which handles its own padding.
    paddingVertical: spacing.sm,
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
