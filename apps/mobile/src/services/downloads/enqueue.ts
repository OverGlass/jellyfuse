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

  return {
    url: resolved.streamUrl,
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
    streamUrl: resolved.streamUrl,
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
