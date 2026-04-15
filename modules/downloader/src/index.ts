import { NitroModules } from "react-native-nitro-modules";
import type { Downloader as DownloaderSpec } from "./Downloader.nitro";

export type {
  Downloader,
  DownloaderListener,
  DownloadOptions,
  NativeChapter,
  NativeDownloadMetadata,
  NativeDownloadRecord,
  NativeDownloadState,
  NativeIntroSkipperSegments,
  NativeSkipSegment,
  NativeTrickplayInfo,
} from "./Downloader.nitro";

/**
 * Create the `Downloader` hybrid object singleton. Instantiate once at
 * the app root and place it in a React context — multiple instances
 * would create separate URLSession configurations and conflict.
 *
 * Call `rebaseAllPaths(FileSystem.documentDirectory)` immediately after
 * creation so stale absolute paths from previous installs are rebased.
 */
export function createDownloader(): DownloaderSpec {
  return NitroModules.createHybridObject<DownloaderSpec>("Downloader");
}
