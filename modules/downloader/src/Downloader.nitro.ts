import type { HybridObject } from "react-native-nitro-modules";

/**
 * `@jellyfuse/downloader` — background download manager Nitro module.
 *
 * iOS: URLSession background downloads + resume-data pause/resume.
 * Android: WorkManager + OkHttp Range (Phase 5e, deferred).
 *
 * Manifest-on-disk-first pattern: every state transition writes
 * `<docDir>/downloads/<id>/manifest.json` BEFORE firing a JS event.
 * On relaunch, `list()` reads all manifests to hydrate before JS asks.
 *
 * Mirrors the Rust `jf-module-download` backend contract:
 *   `crates/jf-module-download/src/backend.rs`
 */

// ──────────────────────────────────────────────────────────────────────────────
// Listener handle (same pattern as native-mpv)
// ──────────────────────────────────────────────────────────────────────────────

export interface DownloaderListener {
  remove: () => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Value types — plain JSON-serialisable structs; no functions
// ──────────────────────────────────────────────────────────────────────────────

export interface NativeChapter {
  startPositionTicks: number;
  name: string;
}

export interface NativeTrickplayInfo {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  thumbnailCount: number;
  /** Milliseconds between thumbnails. */
  interval: number;
}

export interface NativeSkipSegment {
  /** Seconds. */
  start: number;
  /** Seconds. */
  end: number;
}

/**
 * Intro-skipper segment data captured at enqueue time. All fields are
 * optional — if intro-skipper wasn't available for this item, the whole
 * struct may be absent from `metadata`.
 */
export interface NativeIntroSkipperSegments {
  introduction: NativeSkipSegment | undefined;
  recap: NativeSkipSegment | undefined;
  credits: NativeSkipSegment | undefined;
}

/**
 * Rich playback metadata captured at enqueue time so the player can
 * work fully offline — no round trip to the server needed.
 */
export interface NativeDownloadMetadata {
  durationSeconds: number;
  chapters: NativeChapter[];
  trickplayInfo: NativeTrickplayInfo | undefined;
  introSkipperSegments: NativeIntroSkipperSegments | undefined;
}

/** Options passed to `enqueue()`. Populated by `buildDownloadOptions`. */
export interface DownloadOptions {
  /** The URL to download (DirectPlay-forced Jellyfin stream URL). */
  url: string;
  /** Jellyfin item id. */
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  /**
   * Relative path under the document directory where the file should be
   * stored, e.g. `downloads/abc-123/media.mkv`. Rebased on load if
   * the document directory changes between app installs.
   */
  destRelativePath: string;
  /** HTTP headers to pass with the download request (Jellyfin auth). */
  headers: Record<string, string>;
  title: string;
  seriesTitle: string | undefined;
  seasonNumber: number | undefined;
  episodeNumber: number | undefined;
  /** Absolute poster image URL — cached from the Jellyfin server. */
  imageUrl: string | undefined;
  /** The original stream URL (stored for offline playback reference). */
  streamUrl: string;
  metadata: NativeDownloadMetadata;
}

export type NativeDownloadState = "queued" | "downloading" | "paused" | "done" | "failed";

/** Persisted download record — returned by `list()` and event callbacks. */
export interface NativeDownloadRecord {
  /** UUID generated at enqueue time. */
  id: string;
  itemId: string;
  mediaSourceId: string;
  playSessionId: string;
  title: string;
  seriesTitle: string | undefined;
  seasonNumber: number | undefined;
  episodeNumber: number | undefined;
  imageUrl: string | undefined;
  /** The original stream URL passed at enqueue time. */
  streamUrl: string;
  /** Relative path from document directory to the media file. */
  destRelativePath: string;
  bytesDownloaded: number;
  bytesTotal: number;
  state: NativeDownloadState;
  metadata: NativeDownloadMetadata;
  /** Unix milliseconds. */
  addedAtMs: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// HybridObject
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Downloader hybrid object singleton. Create once in the app root,
 * place in a React context, and release never (it lives for the app
 * lifetime).
 *
 * Usage:
 * ```ts
 * const downloader = NitroModules.createHybridObject<Downloader>("Downloader");
 * const id = downloader.enqueue(options);
 * downloader.addProgressListener((id, downloaded, total) => { ... });
 * ```
 */
export interface Downloader extends HybridObject<{ ios: "swift" }> {
  /**
   * Enqueue a new download. Writes the manifest to disk immediately,
   * starts the URLSession task, and returns the assigned UUID.
   */
  enqueue(options: DownloadOptions): string;

  /**
   * Pause an active download. On iOS, cancels with resume data which
   * is stored in the manifest for later `resume()`. No-op if already
   * paused or done.
   */
  pause(id: string): void;

  /**
   * Resume a paused download. Restores from resume data if available,
   * otherwise restarts from a `Range` byte offset. No-op if not paused.
   */
  resume(id: string): void;

  /**
   * Cancel and delete the in-progress download task. The manifest and
   * partial file are removed. No-op if already done or failed.
   */
  cancel(id: string): void;

  /**
   * Delete a completed (or failed) download: removes the manifest and
   * the media file from disk.
   *
   * Named `remove` (not `delete`) because `delete` is a reserved keyword
   * in C++/Objective-C++ and the nitrogen-generated header can't declare
   * a virtual method with that name.
   */
  remove(id: string): void;

  /**
   * Atomically rebase all stored `destRelativePath` values onto
   * `newDocumentDirectory`. Call once on app boot — iOS rotates the
   * app container UUID after dev rebuilds and OS restores, so absolute
   * paths stored in manifests become stale.
   *
   * Mirrors `DownloadStorage::rebase_paths` in the Rust reference.
   */
  rebaseAllPaths(newDocumentDirectory: string): void;

  /**
   * Cancel all active downloads, delete all manifests and media files,
   * and clear all stored records. Prompt the user before calling.
   */
  clearAll(): void;

  /**
   * Return every stored download record by reading manifests from disk.
   * Called on app boot to hydrate the JS state before the first render.
   */
  list(): NativeDownloadRecord[];

  // ── Event listeners ────────────────────────────────────────────────

  /**
   * Fires during active downloads, ~once per second. `bytesTotal` is 0
   * if the server did not report Content-Length.
   */
  addProgressListener(
    onProgress: (id: string, bytesDownloaded: number, bytesTotal: number) => void,
  ): DownloaderListener;

  /**
   * Fires when a download's state changes. State values mirror
   * `NativeDownloadState`.
   */
  addStateChangeListener(
    onStateChange: (id: string, state: NativeDownloadState) => void,
  ): DownloaderListener;
}
