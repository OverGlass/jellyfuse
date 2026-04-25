// React-bound hook that returns the next downloaded episode for the
// current Jellyfin item, as a MediaItem. Subscribes to the live
// downloads list — re-evaluates whenever a new episode finishes
// downloading or the current run grows.
//
// The pure helpers live in `./next-local-episode` so they can be
// unit-tested without an RN runtime; this file is the thin glue.

import type { MediaItem } from "@jellyfuse/models";
import { downloadRecordToMediaItem, findNextLocalEpisode } from "./next-local-episode";
import { useLocalDownloads } from "./use-local-downloads";

export function useNextLocalEpisode(currentItemId: string): MediaItem | undefined {
  const records = useLocalDownloads();
  const next = findNextLocalEpisode(records, currentItemId);
  return next ? downloadRecordToMediaItem(next) : undefined;
}
