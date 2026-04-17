package com.margelo.nitro.downloader

import android.content.Context
import java.io.File

/**
 * Thin wrapper around `<filesDir>/downloads/<id>/manifest.json`. All disk
 * writes go through here so the manifest-on-disk-first guarantee from the
 * Swift port (every state transition persists BEFORE firing a JS event)
 * is preserved.
 *
 * Layout:
 *   <filesDir>/downloads/
 *     <uuid>/
 *       manifest.json    ← ManifestCodec-encoded StoredManifest
 *       media.<ext>      ← written to once state == "done" (see DownloadWorker)
 *
 * The worker is given the id, the docs root (for destRelativePath), and the
 * record dir; this class owns the directory structure.
 */
internal class DownloadRepository(private val context: Context) {

  /** Root that hosts all record subdirectories. Created lazily. */
  val downloadsRoot: File
    get() = File(context.filesDir, "downloads").apply { mkdirs() }

  /**
   * The "document directory" in the Swift port. For the Android equivalent we
   * use `filesDir` (app-private, survives reboots, not backed up by default).
   * `destRelativePath` from `DownloadOptions` is anchored here — final files
   * land at `<docRoot>/<destRelativePath>`.
   */
  val docRoot: File
    get() = context.filesDir

  fun recordDir(id: String): File = File(downloadsRoot, id)

  fun manifestFile(id: String): File = File(recordDir(id), "manifest.json")

  fun writeManifest(manifest: StoredManifest) {
    val dir = recordDir(manifest.id).apply { mkdirs() }
    val tmp = File(dir, "manifest.json.tmp")
    tmp.writeText(ManifestCodec.encode(manifest))
    // Atomic replace — consumers never see a half-written manifest.
    tmp.renameTo(File(dir, "manifest.json"))
  }

  fun readManifest(id: String): StoredManifest? {
    val file = manifestFile(id)
    if (!file.exists()) return null
    return runCatching { ManifestCodec.decode(file.readText()) }.getOrNull()
  }

  fun allManifests(): List<StoredManifest> {
    val root = downloadsRoot
    val entries = root.listFiles() ?: return emptyList()
    return entries.mapNotNull { dir ->
      if (!dir.isDirectory) return@mapNotNull null
      val manifest = File(dir, "manifest.json")
      if (!manifest.exists()) return@mapNotNull null
      runCatching { ManifestCodec.decode(manifest.readText()) }.getOrNull()
    }
  }

  fun updateProgress(id: String, bytesDownloaded: Double, bytesTotal: Double) {
    val m = readManifest(id) ?: return
    m.bytesDownloaded = bytesDownloaded
    m.bytesTotal = bytesTotal
    writeManifest(m)
  }

  fun updateState(id: String, state: String) {
    val m = readManifest(id) ?: return
    m.state = state
    writeManifest(m)
  }

  /** Remove record dir (manifest + partial media file). Used for cancel/remove. */
  fun remove(id: String) {
    recordDir(id).deleteRecursively()
  }

  /** Blows away the whole downloads tree. Used for `clearAll`. */
  fun clearAll() {
    downloadsRoot.deleteRecursively()
    downloadsRoot.mkdirs()
  }

  /**
   * Maps a `StoredManifest` into the Nitro-generated `NativeDownloadRecord`
   * that crosses the JS bridge. Kept alongside the repository rather than in
   * HybridDownloader so the conversion is unit-testable.
   */
  fun toNativeRecord(m: StoredManifest): NativeDownloadRecord {
    val chapters = m.metadata.chapters
      .map { NativeChapter(it.startPositionTicks, it.name) }
      .toTypedArray()
    val trickplay = m.metadata.trickplayInfo?.let {
      NativeTrickplayInfo(
        it.width, it.height, it.tileWidth, it.tileHeight, it.thumbnailCount, it.interval,
      )
    }
    val introSkipper = m.metadata.introSkipperSegments?.let {
      NativeIntroSkipperSegments(
        introduction = it.introduction?.let { s -> NativeSkipSegment(s.start, s.end) },
        recap = it.recap?.let { s -> NativeSkipSegment(s.start, s.end) },
        credits = it.credits?.let { s -> NativeSkipSegment(s.start, s.end) },
      )
    }
    val metadata = NativeDownloadMetadata(
      durationSeconds = m.metadata.durationSeconds,
      chapters = chapters,
      trickplayInfo = trickplay,
      introSkipperSegments = introSkipper,
    )
    val state = when (m.state) {
      "queued" -> NativeDownloadState.QUEUED
      "downloading" -> NativeDownloadState.DOWNLOADING
      "paused" -> NativeDownloadState.PAUSED
      "done" -> NativeDownloadState.DONE
      else -> NativeDownloadState.FAILED
    }
    val sidecars = m.subtitleSidecars.map {
      NativeSubtitleSidecar(
        index = it.index,
        language = it.language,
        displayTitle = it.displayTitle,
        isForced = it.isForced,
        isDefault = it.isDefault,
        format = it.format,
        relativePath = it.relativePath,
      )
    }.toTypedArray()
    return NativeDownloadRecord(
      id = m.id,
      itemId = m.itemId,
      mediaSourceId = m.mediaSourceId,
      playSessionId = m.playSessionId,
      title = m.title,
      seriesTitle = m.seriesTitle,
      seasonNumber = m.seasonNumber,
      episodeNumber = m.episodeNumber,
      imageUrl = m.imageUrl,
      streamUrl = m.streamUrl,
      destRelativePath = m.destRelativePath,
      bytesDownloaded = m.bytesDownloaded,
      bytesTotal = m.bytesTotal,
      state = state,
      metadata = metadata,
      wasOriginal = m.wasOriginal,
      trickplayTileCount = m.trickplayTileCount,
      subtitleSidecars = sidecars,
      addedAtMs = m.addedAtMs,
    )
  }

  /**
   * Mirrors `convertOptions` in the Swift impl. Generates a fresh UUID
   * record id, stamps the enqueue time, and starts the manifest in
   * "queued" state with zeroed byte counters.
   */
  fun manifestFromOptions(options: DownloadOptions, id: String, nowMs: Double): StoredManifest {
    val chapters = options.metadata.chapters.map { StoredChapter(it.startPositionTicks, it.name) }
    val trickplay = options.metadata.trickplayInfo?.let {
      StoredTrickplayInfo(
        it.width, it.height, it.tileWidth, it.tileHeight, it.thumbnailCount, it.interval,
      )
    }
    val introSkipper = options.metadata.introSkipperSegments?.let {
      StoredIntroSkipperSegments(
        introduction = it.introduction?.let { s -> StoredSkipSegment(s.start, s.end) },
        recap = it.recap?.let { s -> StoredSkipSegment(s.start, s.end) },
        credits = it.credits?.let { s -> StoredSkipSegment(s.start, s.end) },
      )
    }
    val metadata = StoredMetadata(
      durationSeconds = options.metadata.durationSeconds,
      chapters = chapters,
      trickplayInfo = trickplay,
      introSkipperSegments = introSkipper,
    )
    return StoredManifest(
      id = id,
      itemId = options.itemId,
      mediaSourceId = options.mediaSourceId,
      playSessionId = options.playSessionId,
      title = options.title,
      seriesTitle = options.seriesTitle,
      seasonNumber = options.seasonNumber,
      episodeNumber = options.episodeNumber,
      imageUrl = options.imageUrl,
      streamUrl = options.streamUrl,
      destRelativePath = options.destRelativePath,
      bytesDownloaded = 0.0,
      // Seed from client-side estimate so the progress bar animates for
      // transcoded streams (where the server won't send Content-Length).
      bytesTotal = options.estimatedBytes,
      state = "queued",
      metadata = metadata,
      addedAtMs = nowMs,
      resumeDataBase64 = null,
      downloadUrl = options.url,
      headers = options.headers,
      wasOriginal = options.wasOriginal,
      trickplayTileCount = 0.0,
      subtitleSidecars = emptyList(),
    )
  }
}
