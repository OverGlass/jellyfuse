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
 * `audioStreams` kept empty (mpv auto-picks the embedded default).
 *
 * **Subtitle sidecars** — for transcoded downloads we populate
 * `subtitleTracks` from `record.subtitleSidecars` with `deliveryUrl`
 * pointing to the local `file://` path. Each entry's `index` is the
 * Jellyfin stream index from when the download ran; the picker maps
 * UI position to mpv sid by `position+1`, which holds because the
 * transcoded container has no embedded subs to offset the count.
 *
 * For Original downloads we intentionally leave subtitleTracks empty
 * — the container already carries every embedded track and mpv's
 * auto-selection picks the default. Re-adding the sidecars via
 * sub-add would double-count and break the position+1 mapping
 * (external tracks get sids AFTER embedded ones; see Rust
 * `PlayerView::build_track_map`).
 *
 * **Trickplay** — when tiles were downloaded (`trickplayTileCount > 0`),
 * we synthesise a `TrickplayData` with a local `sheetUrlTemplate`
 * that expands to `file://.../trickplay/{sheet}.jpg`, so the scrubber
 * can preview offline without hitting the server.
 */
import type { TrickplayData } from "@jellyfuse/api";
import type { DownloadRecord, ResolvedStream, SubtitleTrack } from "@jellyfuse/models";
import { Paths } from "expo-file-system";
import { pickSubtitleTrack, type ResolverSettings } from "@/services/playback/resolver";

function joinDoc(relative: string): string {
  const base = Paths.document.uri.replace(/\/$/, "");
  const rel = relative.replace(/^\//, "");
  return `${base}/${rel}`;
}

export function localFileUrl(record: DownloadRecord): string {
  return joinDoc(record.destRelativePath);
}

/**
 * `downloads/<id>-<mediaSourceId>` — the folder that holds `media`,
 * `trickplay/`, and `subs/`. Derived by stripping the trailing
 * `/media` segment from the manifest's relative path.
 */
function folderRelative(record: DownloadRecord): string {
  return record.destRelativePath.replace(/\/media$/, "");
}

/**
 * Build a `TrickplayData` that resolves to on-disk tile sheets, or
 * return undefined when tiles weren't captured for this record.
 */
export function localTrickplayData(record: DownloadRecord): TrickplayData | undefined {
  const info = record.metadata.trickplayInfo;
  if (!info || record.trickplayTileCount <= 0) return undefined;
  const sheetFolder = joinDoc(`${folderRelative(record)}/trickplay`);
  return {
    width: info.width,
    height: info.height,
    tileWidth: info.tileWidth,
    tileHeight: info.tileHeight,
    thumbnailCount: info.thumbnailCount,
    interval: info.interval,
    sheetUrlTemplate: `${sheetFolder}/{sheet}.jpg`,
  };
}

function sidecarSubtitleTracks(record: DownloadRecord): SubtitleTrack[] {
  if (record.wasOriginal) return [];
  return record.subtitleSidecars.map((s) => ({
    index: s.index,
    language: s.language,
    displayTitle: s.displayTitle,
    codec: s.format,
    isDefault: s.isDefault,
    isForced: s.isForced,
    deliveryUrl: joinDoc(s.relativePath),
  }));
}

export function resolveLocalStream(
  record: DownloadRecord,
  settings?: ResolverSettings,
): ResolvedStream {
  const subtitleTracks = sidecarSubtitleTracks(record);

  // Apply the user's preferred-subtitle-language preference over the
  // offline sidecars. Originals have `subtitleTracks = []` (all tracks
  // are embedded in the container — mpv auto-selects from there, we
  // don't know what's inside), so this only runs for transcoded
  // downloads. Transcoded downloads have NO embedded subtitle tracks,
  // so sidecars are the only subs and their position+1 in this array
  // matches mpv's sid after each sub-add.
  const pick =
    settings && subtitleTracks.length > 0
      ? pickSubtitleTrack(
          subtitleTracks,
          settings.subtitleMode,
          undefined,
          settings.preferredSubtitleLanguage,
        )
      : { index: undefined, deliveryUrl: undefined };
  const subtitleStreamIndex = pick.index;
  const subtitlePosition =
    subtitleStreamIndex !== undefined
      ? subtitleTracks.findIndex((t) => t.index === subtitleStreamIndex)
      : -1;
  const subtitleMpvTrackId = subtitlePosition >= 0 ? subtitlePosition + 1 : undefined;

  return {
    streamUrl: localFileUrl(record),
    playMethod: "DirectPlay",
    mediaSourceId: record.mediaSourceId,
    playSessionId: record.playSessionId,
    audioStreamIndex: undefined,
    subtitleStreamIndex,
    audioMpvTrackId: undefined,
    subtitleMpvTrackId,
    subtitleDeliveryUrl: pick.deliveryUrl,
    audioStreams: [],
    subtitleTracks,
    durationSeconds: record.metadata.durationSeconds,
    chapters: record.metadata.chapters,
    trickplay: record.metadata.trickplayInfo,
    introSkipperSegments: record.metadata.introSkipperSegments,
  };
}
