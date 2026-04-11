import type { MediaItem } from "@jellyfuse/api";
import { colors, fontSize, layout, spacing } from "@jellyfuse/theme";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DetailActionRow } from "@/features/detail/components/detail-action-row";
import { DetailHero } from "@/features/detail/components/detail-hero";
import { EpisodeRow } from "@/features/detail/components/episode-row";
import { SeasonTabs } from "@/features/detail/components/season-tabs";
import { useEpisodes, useSeasons, useSeriesDetail } from "@/services/query";
import { useBreakpoint } from "@/services/responsive";

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

export function SeriesDetailScreen({ itemId }: Props) {
  const seriesQuery = useSeriesDetail(itemId);
  const seasonsQuery = useSeasons(itemId);

  const [activeSeasonId, setActiveSeasonId] = useState<string | undefined>(undefined);
  const resolvedActiveSeasonId = activeSeasonId ?? defaultSeasonId(seasonsQuery.data);

  const episodesQuery = useEpisodes(itemId, resolvedActiveSeasonId);
  const { values } = useBreakpoint();

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
          <Text style={styles.errorTitle}>Couldn't load this series</Text>
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
  const hasResume = (series.progress ?? 0) > 0.01;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <DetailHero item={series} />
        <View style={[styles.body, { paddingHorizontal: values.screenPaddingHorizontal }]}>
          <DetailActionRow
            hasResume={hasResume}
            onPlay={() => {
              console.warn(`play series ${itemId}`);
            }}
            onDownload={() => {
              console.warn(`download series ${itemId}`);
            }}
          />
          {series.overview ? <Text style={styles.overview}>{series.overview}</Text> : null}
          {seasons.length > 0 ? (
            <>
              <SeasonTabs
                seasons={seasons}
                activeSeasonId={resolvedActiveSeasonId}
                onSelect={setActiveSeasonId}
              />
              {episodesQuery.isPending ? <ActivityIndicator color={colors.textSecondary} /> : null}
              {episodes.map((episode) => (
                <EpisodeRow
                  key={keyFor(episode)}
                  item={episode}
                  onPress={() => {
                    console.warn(`play episode ${keyFor(episode)}`);
                  }}
                />
              ))}
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
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
