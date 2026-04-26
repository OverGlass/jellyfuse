/**
 * `(app)/media-actions/[itemId]` — native formSheet shown after a
 * long-press on a `MediaCard` / `WideMediaCard` / `EpisodeRow`, and
 * after a tap on the series detail screen's "Mark Played" entry point.
 *
 * The action sheet's contents depend on the item's `mediaType` and
 * current `played` flag:
 *
 * - Movie / Episode → one row (Mark as Played / Mark as Unplayed).
 * - Series, partially watched → three rows (Mark current episode /
 *   Mark current season / Mark whole show as played). The current
 *   episode + season come from `useSeriesNextUpEpisode`. While that
 *   query is loading we show a spinner above only the cascade option;
 *   once resolved we add the episode + season rows. If the query
 *   returns null (rare — fully watched or empty series), only the
 *   cascade row is shown.
 * - Series, fully watched → one row (Mark whole show as unplayed).
 *
 * Route params:
 * - `itemId` (path)              — Jellyfin item id (movie / episode / series)
 * - `played` (search, "0"/"1")   — current played flag
 * - `seriesId` (search, optional)— parent series id; used by the
 *                                   optimistic patcher to bump
 *                                   `lastPlayedDate` on the series item
 *                                   when the toggle target is an episode.
 * - `title` (search, optional)   — short label shown above the rows
 * - `mediaType` (search, optional) — `MediaType`; drives the option set
 */
import type { MediaType } from "@jellyfuse/models";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  MediaCardActions,
  type MediaCardAction,
} from "@/features/common/components/media-card-actions";
import { useTogglePlayedState } from "@/services/query/hooks/use-played-state";
import { useSeriesNextUpEpisode } from "@/services/query/hooks/use-series-next-up";

export default function MediaActionsRoute() {
  const params = useLocalSearchParams<{
    itemId: string;
    played?: string;
    seriesId?: string;
    title?: string;
    mediaType?: string;
  }>();
  const { t } = useTranslation();
  const togglePlayed = useTogglePlayedState();

  const played = params.played === "1";
  const title = params.title ?? "";
  const mediaType = (params.mediaType ?? undefined) as MediaType | undefined;
  const isSeries = mediaType === "series";

  // Only fetch Next Up when we actually need it — i.e. for a partially
  // watched series. Movies, episodes, and fully-watched series don't
  // need a target episode.
  const seriesNextUp = useSeriesNextUpEpisode(isSeries && !played ? params.itemId : undefined);

  const dismissAfter = (fn: () => void) => () => {
    fn();
    router.dismiss();
  };

  const actions: MediaCardAction[] = (() => {
    if (!params.itemId) return [];

    // Series, fully watched → one option (cascade unmark).
    if (isSeries && played) {
      return [
        {
          key: "series-unplayed",
          label: t("mediaActions.markAllShowUnplayed"),
          onPress: dismissAfter(() => togglePlayed.mutate({ itemId: params.itemId, next: false })),
        },
      ];
    }

    // Series, partially watched → three options when next-up resolves.
    if (isSeries && !played) {
      const rows: MediaCardAction[] = [];
      const nextUp = seriesNextUp.data;
      const targetEpisodeId =
        nextUp && nextUp.id.kind !== "tmdb" ? nextUp.id.jellyfinId : undefined;
      const targetSeasonId = nextUp?.seasonId;
      if (targetEpisodeId) {
        rows.push({
          key: "episode-played",
          label: t("mediaActions.markCurrentEpisodePlayed"),
          onPress: dismissAfter(() =>
            togglePlayed.mutate({
              itemId: targetEpisodeId,
              next: true,
              seriesId: params.itemId,
            }),
          ),
        });
      }
      if (targetSeasonId) {
        rows.push({
          key: "season-played",
          label: t("mediaActions.markCurrentSeasonPlayed"),
          onPress: dismissAfter(() =>
            togglePlayed.mutate({
              itemId: targetSeasonId,
              next: true,
              seriesId: params.itemId,
            }),
          ),
        });
      }
      rows.push({
        key: "series-played",
        label: t("mediaActions.markAllShowPlayed"),
        onPress: dismissAfter(() => togglePlayed.mutate({ itemId: params.itemId, next: true })),
      });
      return rows;
    }

    // Movie / episode / anything else → single toggle row.
    return [
      {
        key: "single",
        label: played ? t("mediaActions.markUnplayed") : t("mediaActions.markPlayed"),
        onPress: dismissAfter(() =>
          togglePlayed.mutate({
            itemId: params.itemId,
            next: !played,
            seriesId: params.seriesId || undefined,
          }),
        ),
      },
    ];
  })();

  // Spinner only fires for the partially-watched series path while
  // Next Up resolves. Once the query returns we render the full
  // option list (or fall back to just the cascade row).
  const loading = isSeries && !played && seriesNextUp.isPending;

  return (
    <MediaCardActions
      title={title}
      actions={actions}
      onCancel={() => router.dismiss()}
      loading={loading}
    />
  );
}
