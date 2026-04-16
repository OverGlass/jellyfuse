/**
 * `local-stream` — bridge a completed `DownloadRecord` into a
 * `ResolvedStream` the player can consume without touching the network.
 *
 * The Nitro downloader stores files under
 * `<documentDirectory>/downloads/<id>-<mediaSourceId>/media`. The
 * manifest's `destRelativePath` is rooted at the document directory,
 * so the absolute `file://` URL is just `Paths.document.uri` joined
 * with that relative path. Using `expo-file-system` (already bundled
 * with Expo) avoids a round-trip through a new Nitro method.
 *
 * `resolveLocalStream(record)` returns a `ResolvedStream` shaped like
 * what `resolvePlayback()` would produce — but with `playMethod`
 * forced to `DirectPlay` (a local file is always direct play) and
 * empty `audioStreams` / `subtitleTracks` arrays (the record doesn't
 * preserve them; mpv auto-picks embedded tracks).
 *
 * Used by the player screen for local-first play: if the item has a
 * `done` download, we skip `/PlaybackInfo` entirely and hand the MPV
 * instance the local file + cached metadata.
 */
import { Paths } from "expo-file-system";
import type { DownloadRecord, ResolvedStream } from "@jellyfuse/models";

export function localFileUrl(record: DownloadRecord): string {
  const base = Paths.document.uri.replace(/\/$/, "");
  const rel = record.destRelativePath.replace(/^\//, "");
  return `${base}/${rel}`;
}

export function resolveLocalStream(record: DownloadRecord): ResolvedStream {
  return {
    streamUrl: localFileUrl(record),
    playMethod: "DirectPlay",
    mediaSourceId: record.mediaSourceId,
    playSessionId: record.playSessionId,
    audioStreamIndex: undefined,
    subtitleStreamIndex: undefined,
    subtitleDeliveryUrl: undefined,
    audioStreams: [],
    subtitleTracks: [],
    durationSeconds: record.metadata.durationSeconds,
    chapters: record.metadata.chapters,
    trickplay: record.metadata.trickplayInfo,
    introSkipperSegments: record.metadata.introSkipperSegments,
  };
}
