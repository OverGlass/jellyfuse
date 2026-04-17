/**
 * `useItemDownload` — shared download dispatch for any `MediaItem`
 * (movie or episode). Factored out so the movie detail action row
 * and each episode row in the series detail screen run identical
 * logic.
 *
 * Returned `handleDownloadPress(item, record)`:
 *   done        → play the item locally (`/player/:id`)
 *   downloading → pause
 *   paused      → resume
 *   queued      → no-op
 *   failed      → remove the stale record, then open the quality picker
 *   undefined   → open the quality picker formSheet
 *
 * The quality picker lives at `/download-quality/[itemId]` and is
 * presented as a native formSheet. We stash the pending `MediaItem`
 * into the RQ cache under `queryKeys.pendingDownload(itemId)` before
 * navigating so the sheet can pick up the full item (series/episode
 * metadata included) without route-param plumbing. The sheet owns
 * the PlaybackInfo fetch + enqueue pipeline.
 */
import type { MediaItem, DownloadRecord } from "@jellyfuse/models";
import { queryKeys } from "@jellyfuse/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback } from "react";
import { useDownloaderActions } from "./use-local-downloads";

export function useItemDownload() {
  const actions = useDownloaderActions();
  const queryClient = useQueryClient();

  return useCallback(
    (item: MediaItem, record: DownloadRecord | undefined) => {
      const jellyfinId =
        item.id.kind === "jellyfin" || item.id.kind === "both" ? item.id.jellyfinId : undefined;
      if (!jellyfinId) return;

      if (record?.state === "done") {
        router.push(`/player/${jellyfinId}`);
        return;
      }
      if (record?.state === "downloading") {
        actions.pause(record.id);
        return;
      }
      if (record?.state === "paused") {
        actions.resume(record.id);
        return;
      }
      if (record?.state === "queued") {
        return;
      }
      if (record?.state === "failed") {
        actions.remove(record.id);
      }

      queryClient.setQueryData(queryKeys.pendingDownload(jellyfinId), item);
      router.push(`/download-quality/${jellyfinId}`);
    },
    [actions, queryClient],
  );
}
