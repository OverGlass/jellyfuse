/**
 * `sidecar-download` — best-effort fetch of trickplay tile sheets and
 * external subtitle files into the download record's folder on disk,
 * then persists the metadata via `downloader.attachSidecars()`.
 *
 * Runs fire-and-forget after `downloader.enqueue()` returns. The main
 * media file goes through URLSession background downloads; sidecars
 * are small and quick so they ride on the foreground session via
 * `File.downloadFileAsync()`. If the app backgrounds before they
 * finish, they just restart on the next download attempt — the
 * manifest only stores what made it to disk.
 *
 * Layout on disk (all relative to `Paths.document`):
 *   downloads/<id>-<mediaSourceId>/media              (main video)
 *   downloads/<id>-<mediaSourceId>/trickplay/{n}.jpg  (tile sheets)
 *   downloads/<id>-<mediaSourceId>/subs/{idx}.{ext}   (subtitles)
 *
 * The `<id>-<mediaSourceId>` prefix matches the convention used by
 * `buildDownloadOptions` (see `enqueue.ts`). We derive it here by
 * stripping `/media` from the manifest's `destRelativePath` so the
 * media and sidecars stay co-located regardless of whether the ext
 * landed as `.mp4`, `.mkv`, etc.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { Downloader, NativeSubtitleSidecar } from "@jellyfuse/downloader";
import type { ResolvedStream, SubtitleTrack } from "@jellyfuse/models";
import { type TrickplayData } from "@jellyfuse/api";
import { queryKeys } from "@jellyfuse/query-keys";
import { Directory, File, Paths } from "expo-file-system";

interface Ctx {
  id: string;
  jellyfinId: string;
  /** Matches the `destRelativePath` parent — `downloads/<id>-<mediaSourceId>`. */
  folderRelative: string;
  resolved: ResolvedStream;
  authHeader: string;
  queryClient: QueryClient;
  downloader: Downloader;
}

export async function downloadSidecars(ctx: Ctx): Promise<void> {
  const [tileResult, subsResult] = await Promise.allSettled([
    downloadTrickplayTiles(ctx),
    downloadSubtitleSidecars(ctx),
  ]);

  const trickplayTileCount = tileResult.status === "fulfilled" ? tileResult.value : 0;
  const subtitleSidecars = subsResult.status === "fulfilled" ? subsResult.value : [];

  try {
    ctx.downloader.attachSidecars(ctx.id, { trickplayTileCount, subtitleSidecars });
  } catch (e) {
    console.warn("[sidecar-download] attachSidecars failed:", e);
  }
}

async function downloadTrickplayTiles(ctx: Ctx): Promise<number> {
  const cached = ctx.queryClient.getQueryData<TrickplayData>(
    queryKeys.trickplayInfo(ctx.jellyfinId),
  );
  if (!cached || cached.thumbnailCount <= 0) return 0;

  const tilesPerSheet = cached.tileWidth * cached.tileHeight;
  if (tilesPerSheet <= 0) return 0;
  const sheetCount = Math.ceil(cached.thumbnailCount / tilesPerSheet);
  if (sheetCount <= 0) return 0;

  const dir = new Directory(Paths.document, ctx.folderRelative, "trickplay");
  try {
    if (!dir.exists) dir.create({ intermediates: true });
  } catch {
    return 0;
  }

  const results = await Promise.allSettled(
    Array.from({ length: sheetCount }, (_, i) => {
      const sheetUrl = cached.sheetUrlTemplate.replace("{sheet}", String(i));
      const dest = new File(dir, `${i}.jpg`);
      return File.downloadFileAsync(sheetUrl, dest, {
        headers: { Authorization: ctx.authHeader },
      });
    }),
  );

  // Return the largest contiguous prefix of successful sheets — a gap
  // in the middle would break `trickplayTileFor()`'s sheet index math,
  // so report 0 if any sheet failed.
  const firstFailure = results.findIndex((r) => r.status === "rejected");
  return firstFailure === -1 ? sheetCount : 0;
}

async function downloadSubtitleSidecars(ctx: Ctx): Promise<NativeSubtitleSidecar[]> {
  const external = ctx.resolved.subtitleTracks.filter(
    (t): t is SubtitleTrack & { deliveryUrl: string } => Boolean(t.deliveryUrl),
  );
  if (external.length === 0) return [];

  const dir = new Directory(Paths.document, ctx.folderRelative, "subs");
  try {
    if (!dir.exists) dir.create({ intermediates: true });
  } catch {
    return [];
  }

  const results = await Promise.allSettled(
    external.map(async (track) => {
      const format = extractExtension(track.deliveryUrl) ?? "vtt";
      const dest = new File(dir, `${track.index}.${format}`);
      await File.downloadFileAsync(track.deliveryUrl, dest, {
        headers: { Authorization: ctx.authHeader },
      });
      const record: NativeSubtitleSidecar = {
        index: track.index,
        language: track.language,
        displayTitle: track.displayTitle,
        isForced: track.isForced,
        isDefault: track.isDefault,
        format,
        relativePath: `${ctx.folderRelative}/subs/${track.index}.${format}`,
      };
      return record;
    }),
  );

  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

function extractExtension(url: string): string | undefined {
  const pathOnly = url.split("?")[0] ?? url;
  const dot = pathOnly.lastIndexOf(".");
  const slash = pathOnly.lastIndexOf("/");
  if (dot <= slash) return undefined;
  const ext = pathOnly.slice(dot + 1).toLowerCase();
  if (ext.length === 0 || ext.length > 5) return undefined;
  return ext;
}
