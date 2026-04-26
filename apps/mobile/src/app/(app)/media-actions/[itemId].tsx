/**
 * `(app)/media-actions/[itemId]` — native formSheet shown after a
 * long-press on a `MediaCard` / `WideMediaCard`. Hosts the
 * `<MediaCardActions />` rows (Mark Played / Mark Unplayed today) and
 * fires `useTogglePlayedState` when an action is chosen.
 *
 * Route params:
 * - `itemId` (path)            — Jellyfin item id
 * - `played` (search, "0"/"1") — current played flag, drives the row label
 * - `seriesId` (search, optional) — when toggling an episode, used to
 *   patch the parent series detail's `lastPlayedDate` optimistically.
 * - `title` (search)           — short label shown above the action rows
 */
import { router, useLocalSearchParams } from "expo-router";
import { MediaCardActions } from "@/features/common/components/media-card-actions";
import { useTogglePlayedState } from "@/services/query/hooks/use-played-state";

export default function MediaActionsRoute() {
  const params = useLocalSearchParams<{
    itemId: string;
    played?: string;
    seriesId?: string;
    title?: string;
  }>();
  const togglePlayed = useTogglePlayedState();

  const played = params.played === "1";
  const title = params.title ?? "";

  const handleTogglePlayed = () => {
    if (!params.itemId) {
      router.dismiss();
      return;
    }
    togglePlayed.mutate({
      itemId: params.itemId,
      next: !played,
      seriesId: params.seriesId || undefined,
    });
    router.dismiss();
  };

  return (
    <MediaCardActions
      title={title}
      played={played}
      onTogglePlayed={handleTogglePlayed}
      onCancel={() => router.dismiss()}
    />
  );
}
