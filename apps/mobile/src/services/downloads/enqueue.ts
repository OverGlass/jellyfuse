/**
 * Assembles `DownloadOptions` from a resolved playback stream + cached
 * metadata, then calls `downloader.enqueue()`. This is Phase 5b's
 * metadata-capture-at-enqueue logic.
 *
 * Mirrors the Rust pattern from commit `f29ff269`:
 *   capture duration + chapters + intro-skipper + trickplay at enqueue
 *   time so offline playback is full-fidelity.
 *
 * Priority order for metadata (best-effort, never blocks the enqueue):
 *   1. Already in `resolved` (freshest — just fetched for playback)
 *   2. Already in the RQ cache (e.g. intro-skipper / trickplay
 *      fetched when the detail screen opened)
 *   3. Absent — field is undefined, gracefully omitted at playback
 */
import type { QueryClient } from "@tanstack/react-query";
import type { DownloadOptions } from "@jellyfuse/downloader";
import type {
  IntroSkipperSegments,
  MediaItem,
  ResolvedStream,
  TrickplayInfo,
} from "@jellyfuse/models";
import { buildDownloadUrl, buildTranscodedDownloadUrl } from "@jellyfuse/api";
import { queryKeys } from "@jellyfuse/query-keys";

/**
 * Build the `DownloadOptions` payload passed to `downloader.enqueue()`.
 *
 * @param item       The `MediaItem` being downloaded (for title, poster, series metadata).
 * @param resolved   The `ResolvedStream` from `usePlaybackInfo` (carries chapters, trickplay,
 *                   intro-skipper, duration).
 * @param authHeader The Jellyfin `X-Emby-Authorization` header value — needed because
 *                   the download URL is a DirectPlay stream that requires auth.
 * @param queryClient Used to read any already-cached intro-skipper / trickplay data.
 */
export function buildDownloadOptions(
  item: MediaItem,
  resolved: ResolvedStream,
  authHeader: string,
  queryClient: QueryClient,
  download: { baseUrl: string; token: string },
  options?: { maxBitrate?: number },
): DownloadOptions {
  const jellyfinId =
    item.id.kind === "jellyfin" || item.id.kind === "both" ? item.id.jellyfinId : "";

  // Try to get intro-skipper segments from resolved stream first, then RQ cache
  const introSkipperSegments: IntroSkipperSegments | undefined =
    resolved.introSkipperSegments ??
    queryClient.getQueryData<IntroSkipperSegments>(queryKeys.introSkipper(jellyfinId));

  // Try to get trickplay info from resolved stream first, then RQ cache
  const trickplayInfo: TrickplayInfo | undefined =
    resolved.trickplay ??
    queryClient.getQueryData<TrickplayInfo>(queryKeys.trickplayInfo(jellyfinId));

  // dest path: downloads/<jellyfinId>-<mediaSourceId>/media
  // Extension is deliberately omitted here — the downloader will use
  // the response's Content-Disposition or default to .mp4. Using a
  // predictable path lets rebaseAllPaths work without knowing the ext.
  const destRelativePath = `downloads/${jellyfinId}-${resolved.mediaSourceId}/media`;

  // Original quality → canonical `/Items/{id}/Download` (raw source file,
  // all tracks embedded). Non-Original qualities → `/Videos/{id}/stream.mp4`
  // with `Static=false` + MaxStreamingBitrate so the server transcodes on
  // the fly and streams a single MP4 file. Both paths send a real
  // `Content-Length` so progress reporting works end-to-end.
  const downloadUrl = options?.maxBitrate
    ? buildTranscodedDownloadUrl({
        baseUrl: download.baseUrl,
        itemId: jellyfinId,
        mediaSourceId: resolved.mediaSourceId,
        token: download.token,
        maxBitrate: options.maxBitrate,
      })
    : buildDownloadUrl({
        baseUrl: download.baseUrl,
        itemId: jellyfinId,
        token: download.token,
      });

  // Transcoded streams arrive chunked with no `Content-Length`, so
  // `URLSession` reports `totalBytesExpectedToWrite = -1` and the
  // progress bar never moves. We estimate client-side from the chosen
  // bitrate cap × duration (÷ 8 to convert bits → bytes) and hand that
  // to the downloader as a seed value. Original downloads leave this at
  // 0 — the real Content-Length arrives with the response headers.
  const estimatedBytes =
    options?.maxBitrate && resolved.durationSeconds > 0
      ? Math.round((options.maxBitrate * resolved.durationSeconds) / 8)
      : 0;

  return {
    url: downloadUrl,
    itemId: jellyfinId,
    mediaSourceId: resolved.mediaSourceId,
    playSessionId: resolved.playSessionId,
    destRelativePath,
    headers: {
      Authorization: authHeader,
    },
    title: item.title,
    seriesTitle: item.seriesName,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
    imageUrl: item.posterUrl,
    streamUrl: downloadUrl,
    estimatedBytes,
    wasOriginal: !options?.maxBitrate,
    metadata: {
      durationSeconds: resolved.durationSeconds,
      chapters: resolved.chapters.map((c) => ({
        startPositionTicks: c.startPositionTicks,
        name: c.name,
      })),
      trickplayInfo: trickplayInfo
        ? {
            width: trickplayInfo.width,
            height: trickplayInfo.height,
            tileWidth: trickplayInfo.tileWidth,
            tileHeight: trickplayInfo.tileHeight,
            thumbnailCount: trickplayInfo.thumbnailCount,
            interval: trickplayInfo.interval,
          }
        : undefined,
      introSkipperSegments: introSkipperSegments
        ? {
            introduction: introSkipperSegments.introduction,
            recap: introSkipperSegments.recap,
            credits: introSkipperSegments.credits,
          }
        : undefined,
    },
  };
}
