package com.margelo.nitro.downloader

import android.content.Context
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Android port of `HybridDownloader.swift`. Uses WorkManager + a
 * `CoroutineWorker` (see `DownloadWorker`) to run HTTP downloads in a
 * foreground service so the OS doesn't reap them. The single JS
 * instance here is the coordinator: it persists manifests, schedules
 * work, and fans event-bus updates out to every registered listener.
 *
 * All state-changing methods follow the manifest-on-disk-first contract:
 * a record exists on disk BEFORE any work is enqueued, so relaunch can
 * always hydrate the JS list from disk without waiting for events.
 *
 * Error codes (stable across native platforms):
 *   - `downloader.not_ready`        — NitroModules.applicationContext null
 *   - `downloader.invalid_url`      — malformed download URL
 *   - `downloader.manifest_read_failed` — corrupt manifest on disk
 *   - `downloader.network`          — transport failure (from worker)
 *   - `downloader.disk_full`        — ENOSPC while writing (from worker)
 *   - `downloader.cancelled`        — user-initiated cancellation
 */
@DoNotStrip
class HybridDownloader : HybridDownloaderSpec() {

  private val appContext: Context
    get() = NitroModules.applicationContext
      ?: throw Error("downloader.not_ready")

  private val repo: DownloadRepository by lazy { DownloadRepository(appContext) }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

  init {
    // Make sure the downloads root exists on first launch so list() doesn't
    // blow up before the first enqueue.
    runCatching { repo.downloadsRoot }
    DownloadWorker.ensureChannel(appContext)
  }

  override fun enqueue(options: DownloadOptions): String {
    if (options.url.isBlank()) throw Error("downloader.invalid_url")

    val id = UUID.randomUUID().toString()
    val nowMs = System.currentTimeMillis().toDouble()
    val manifest = repo.manifestFromOptions(options, id, nowMs)
    repo.writeManifest(manifest)
    DownloadEventBus.emitStateChange(id, NativeDownloadState.QUEUED)

    scheduleWork(id)
    return id
  }

  override fun pause(id: String) {
    // Cancel the WorkManager job — the worker catches CancellationException
    // and writes state=paused + persists bytes. We also update the manifest
    // eagerly so a racing list() sees paused before the worker's catch runs.
    WorkManager.getInstance(appContext).cancelUniqueWork(workName(id))
    val m = repo.readManifest(id) ?: return
    if (m.state == "paused") return
    repo.updateState(id, "paused")
    DownloadEventBus.emitStateChange(id, NativeDownloadState.PAUSED)
  }

  override fun resume(id: String) {
    val m = repo.readManifest(id) ?: return
    if (m.state == "done" || m.state == "downloading") return
    scheduleWork(id)
  }

  override fun cancel(id: String) {
    WorkManager.getInstance(appContext).cancelUniqueWork(workName(id))
    repo.remove(id)
    DownloadEventBus.emitStateChange(id, NativeDownloadState.FAILED)
  }

  override fun remove(id: String) {
    // Same on-disk semantics as cancel — we don't distinguish mid-flight
    // vs. completed deletes on Android (the user intent is the same:
    // wipe the record).
    WorkManager.getInstance(appContext).cancelUniqueWork(workName(id))
    repo.remove(id)
  }

  override fun rebaseAllPaths(newDocumentDirectory: String) {
    // No-op: destRelativePath is already stored as a path relative to
    // filesDir. Parity with the Swift API for the single cross-platform
    // JS caller.
  }

  override fun clearAll() {
    val wm = WorkManager.getInstance(appContext)
    repo.allManifests().forEach { wm.cancelUniqueWork(workName(it.id)) }
    repo.clearAll()
  }

  override fun list(): Array<NativeDownloadRecord> {
    return repo.allManifests().map { repo.toNativeRecord(it) }.toTypedArray()
  }

  override fun attachSidecars(id: String, attachment: NativeSidecarAttachment) {
    val m = repo.readManifest(id) ?: return
    val merged = m.copy(
      trickplayTileCount = attachment.trickplayTileCount,
      subtitleSidecars = attachment.subtitleSidecars.map {
        StoredSubtitleSidecar(
          index = it.index,
          language = it.language,
          displayTitle = it.displayTitle,
          isForced = it.isForced,
          isDefault = it.isDefault,
          format = it.format,
          relativePath = it.relativePath,
        )
      },
    )
    repo.writeManifest(merged)
  }

  override fun addProgressListener(
    onProgress: (id: String, bytesDownloaded: Double, bytesTotal: Double) -> Unit,
  ): DownloaderListener {
    val job: Job = scope.launch {
      DownloadEventBus.events.collect { event ->
        if (event is DownloadEvent.Progress) {
          onProgress(event.id, event.bytesDownloaded, event.bytesTotal)
        }
      }
    }
    return DownloaderListener(remove = { job.cancel() })
  }

  override fun addStateChangeListener(
    onStateChange: (id: String, state: NativeDownloadState) -> Unit,
  ): DownloaderListener {
    val job: Job = scope.launch {
      DownloadEventBus.events.collect { event ->
        if (event is DownloadEvent.StateChange) {
          onStateChange(event.id, event.state)
        }
      }
    }
    return DownloaderListener(remove = { job.cancel() })
  }

  // MARK: - Private

  /**
   * Schedules (or re-schedules on resume) the worker for this download id.
   * Uses a per-id unique work name with REPLACE so consecutive pauses /
   * resumes never fork the same download into two concurrent workers.
   */
  private fun scheduleWork(id: String) {
    val input = Data.Builder().putString(DownloadWorker.KEY_ID, id).build()
    val req: OneTimeWorkRequest = OneTimeWorkRequestBuilder<DownloadWorker>()
      .setInputData(input)
      .addTag(WORK_TAG)
      .build()

    WorkManager.getInstance(appContext).enqueueUniqueWork(
      workName(id),
      ExistingWorkPolicy.REPLACE,
      req,
    )
  }

  private fun workName(id: String): String = "$WORK_TAG.$id"

  companion object {
    private const val WORK_TAG = "jellyfuse.downloader"

    init {
      System.loadLibrary("Downloader")
    }
  }
}
