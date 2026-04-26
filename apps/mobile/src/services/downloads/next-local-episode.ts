// Offline "what plays next" — pure helpers for finding the next
// downloaded episode in the same series and adapting a download
// record into the MediaItem shape the player expects.
//
// The download record carries `seriesTitle` + `seasonNumber` +
// `episodeNumber` but no `seriesId`, so we group by `seriesTitle`. In
// practice that's stable for the offline-autoplay use case (the user
// downloaded a contiguous run from one series). If two series happen
// to share a title, the worst case is autoplaying the wrong show — a
// non-blocking quirk we accept to avoid native-side schema changes.
//
// `findNextLocalEpisode` returns `undefined` when:
//   - the current item isn't in the downloads list
//   - the current record is missing season/episode metadata
//   - there is no completed download AFTER the current (season,
//     episode) in the same series.

import type { DownloadRecord, MediaItem } from "@jellyfuse/models";

export function findNextLocalEpisode(
  records: readonly DownloadRecord[],
  currentItemId: string,
): DownloadRecord | undefined {
  const current = records.find((r) => r.itemId === currentItemId);
  if (!current) return undefined;
  if (
    current.seriesTitle === undefined ||
    current.seasonNumber === undefined ||
    current.episodeNumber === undefined
  ) {
    return undefined;
  }

  const seriesEpisodes: DownloadRecord[] = [];
  for (const r of records) {
    if (r.state !== "done") continue;
    if (r.seriesTitle !== current.seriesTitle) continue;
    if (r.seasonNumber === undefined || r.episodeNumber === undefined) continue;
    seriesEpisodes.push(r);
  }
  seriesEpisodes.sort((a, b) => {
    const sa = a.seasonNumber as number;
    const sb = b.seasonNumber as number;
    if (sa !== sb) return sa - sb;
    return (a.episodeNumber as number) - (b.episodeNumber as number);
  });

  const idx = seriesEpisodes.findIndex((r) => r.itemId === currentItemId);
  if (idx === -1) return undefined;
  return seriesEpisodes[idx + 1];
}

/**
 * Build a minimal MediaItem from a download record. Filled enough for
 * the End-of-Episode overlay (id, title, season/episode for the label)
 * and for the player route (`mediaIdJellyfin(item.id)`). Any field we
 * don't have offline is left undefined — the consumers tolerate it.
 */
export function downloadRecordToMediaItem(record: DownloadRecord): MediaItem {
  return {
    id: { kind: "jellyfin", jellyfinId: record.itemId },
    source: "jellyfin",
    availability: { kind: "available" },
    mediaType: "episode",
    title: record.title,
    sortTitle: undefined,
    year: undefined,
    overview: undefined,
    posterUrl: record.imageUrl,
    backdropUrl: undefined,
    logoUrl: undefined,
    genres: [],
    rating: undefined,
    progress: undefined,
    runtimeMinutes: undefined,
    userData: undefined,
    seasonCount: undefined,
    episodeCount: undefined,
    seriesName: record.seriesTitle,
    seasonNumber: record.seasonNumber,
    episodeNumber: record.episodeNumber,
    seriesId: undefined,
    seasonId: undefined,
  };
}
