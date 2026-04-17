package com.margelo.nitro.downloader

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/**
 * Background download worker. Ports `URLSessionDownloadTask` semantics onto
 * OkHttp + WorkManager:
 *
 *   - Manifest-on-disk-first: state changes are persisted before events are
 *     emitted to JS (see `DownloadEventBus`).
 *   - Range-based resume: Android has no URLSession resume-data equivalent,
 *     so we persist `bytesDownloaded` and re-issue a `Range: bytes=N-`
 *     request on resume. If the server responds with 200 (ignored Range),
 *     we truncate the partial file and start over rather than silently
 *     corrupting the output.
 *   - Cancellation: WorkManager cancels translate to CancellationException,
 *     which we treat as "paused" — the worker keeps the partial file and
 *     updates the manifest state so the next enqueue can resume cleanly.
 *     If the record dir is missing when we wake up (user called
 *     `cancel()` / `remove()`), we exit silently.
 *
 * The worker never *removes* partial files on pause; cleanup is the
 * responsibility of `HybridDownloader.cancel` / `remove`.
 */
internal class DownloadWorker(
  appContext: Context,
  params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

  private val repo = DownloadRepository(appContext)

  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val id = inputData.getString(KEY_ID)
      ?: return@withContext Result.failure()

    val manifest = repo.readManifest(id) ?: return@withContext Result.success()

    // Promote to foreground immediately so the OS doesn't kill us on slow
    // backends. `foregroundServiceType=dataSync` is required on API 34+.
    runCatching { setForeground(buildForegroundInfo(manifest.title, 0, 0)) }

    // Move to "downloading" before the first byte. The UI needs this
    // transition to render the progress indicator.
    repo.updateState(id, "downloading")
    DownloadEventBus.emitStateChange(id, NativeDownloadState.DOWNLOADING)

    val partialFile = File(repo.recordDir(id), "media.part")

    val result = try {
      downloadOnce(id, manifest, partialFile)
    } catch (ce: CancellationException) {
      // WorkManager cancelled us — treat as a pause. Persist byte count so
      // the next enqueue can resume from here.
      val current = repo.readManifest(id)
      if (current != null) {
        val bytes = partialFile.length().toDouble()
        repo.updateProgress(id, bytes, current.bytesTotal)
        repo.updateState(id, "paused")
        DownloadEventBus.emitStateChange(id, NativeDownloadState.PAUSED)
      }
      throw ce
    } catch (t: Throwable) {
      // `downloader.not_implemented` / `downloader.invalid_url` etc. are
      // thrown from enqueue path before the worker runs; anything here is
      // a runtime transport/disk failure.
      android.util.Log.e(TAG, "download $id failed: ${t.message}", t)
      repo.updateState(id, "failed")
      DownloadEventBus.emitStateChange(id, NativeDownloadState.FAILED)
      Result.failure()
    }

    result
  }

  override suspend fun getForegroundInfo(): ForegroundInfo {
    val id = inputData.getString(KEY_ID) ?: ""
    val manifest = repo.readManifest(id)
    return buildForegroundInfo(manifest?.title ?: "Download", 0, 0)
  }

  private suspend fun downloadOnce(
    id: String,
    startManifest: StoredManifest,
    partialFile: File,
  ): Result {
    val resumeFrom = partialFile.length().also { repo.recordDir(id).mkdirs() }
    val reqBuilder = Request.Builder().url(startManifest.downloadUrl)
    startManifest.headers.forEach { (k, v) -> reqBuilder.header(k, v) }
    if (resumeFrom > 0) {
      reqBuilder.header("Range", "bytes=$resumeFrom-")
    }

    val response: Response = try {
      httpClient.newCall(reqBuilder.build()).execute()
    } catch (ioe: IOException) {
      throw RuntimeException("downloader.network", ioe)
    }

    response.use { res ->
      if (!res.isSuccessful) {
        throw RuntimeException("downloader.network: HTTP ${res.code}")
      }

      // Server ignored our Range — truncate and restart. Happens with some
      // Jellyfin transcode URLs where the stream is synthesised on demand.
      val rangeHonored = res.code == 206
      val appendMode = rangeHonored && resumeFrom > 0
      if (!appendMode) {
        partialFile.delete()
      }

      val total: Double = run {
        val contentLength = res.body?.contentLength() ?: -1L
        when {
          // No Content-Length (transcoded streams) — fall back to the
          // client-side estimate stamped onto the manifest at enqueue so
          // the progress bar still animates instead of sitting at 0.
          contentLength <= 0 -> startManifest.bytesTotal
          appendMode -> (contentLength + resumeFrom).toDouble()
          else -> contentLength.toDouble()
        }
      }

      val body = res.body ?: throw RuntimeException("downloader.network: empty body")

      // Stream the body into the partial file, emitting throttled progress.
      writeBody(id, body.byteStream(), partialFile, appendMode, total)

      // Finalise: move partial to final destination path (under docRoot).
      val finalFile = File(repo.docRoot, startManifest.destRelativePath)
      finalFile.parentFile?.mkdirs()
      if (finalFile.exists()) finalFile.delete()
      if (!partialFile.renameTo(finalFile)) {
        // Cross-filesystem rename can fail — fall back to a copy.
        partialFile.copyTo(finalFile, overwrite = true)
        partialFile.delete()
      }

      val done = repo.readManifest(id)
      if (done != null) {
        done.bytesDownloaded = finalFile.length().toDouble()
        if (done.bytesTotal <= 0.0) done.bytesTotal = done.bytesDownloaded
        done.state = "done"
        repo.writeManifest(done)
      }
      DownloadEventBus.emitStateChange(id, NativeDownloadState.DONE)
      return Result.success()
    }
  }

  /**
   * Pumps bytes from the HTTP stream into the partial file. Progress events
   * are throttled to ~1Hz to match the Swift reporter cadence, so we don't
   * flood the JS bridge with tens of thousands of updates per MB.
   */
  private suspend fun writeBody(
    id: String,
    inputStream: java.io.InputStream,
    partialFile: File,
    appendMode: Boolean,
    total: Double,
  ) {
    val buf = ByteArray(64 * 1024)
    var lastEmitAt = 0L
    val raf = RandomAccessFile(partialFile, "rw")
    try {
      if (appendMode) raf.seek(raf.length()) else raf.setLength(0L)
      while (true) {
        yield() // respect cancellation
        val read = inputStream.read(buf)
        if (read <= 0) break
        try {
          raf.write(buf, 0, read)
        } catch (ioe: IOException) {
          val msg = ioe.message ?: ""
          if (msg.contains("ENOSPC", ignoreCase = true) ||
            msg.contains("No space", ignoreCase = true)
          ) {
            throw RuntimeException("downloader.disk_full", ioe)
          }
          throw RuntimeException("downloader.network", ioe)
        }
        val now = System.currentTimeMillis()
        if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
          lastEmitAt = now
          val downloaded = raf.length().toDouble()
          repo.updateProgress(id, downloaded, total)
          DownloadEventBus.emitProgress(id, downloaded, total)
        }
      }
      // Final progress emission at completion.
      val finalDownloaded = raf.length().toDouble()
      repo.updateProgress(id, finalDownloaded, total.takeIf { it > 0 } ?: finalDownloaded)
      DownloadEventBus.emitProgress(id, finalDownloaded, total.takeIf { it > 0 } ?: finalDownloaded)
    } finally {
      runCatching { raf.close() }
      runCatching { inputStream.close() }
    }
  }

  private fun buildForegroundInfo(title: String, done: Long, total: Long): ForegroundInfo {
    ensureChannel(applicationContext)
    val notif: Notification = NotificationCompat.Builder(applicationContext, NOTIF_CHANNEL_ID)
      .setContentTitle(title)
      .setContentText("Downloading…")
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .apply {
        if (total > 0 && done >= 0) {
          setProgress(total.toInt(), done.toInt(), false)
        } else {
          setProgress(0, 0, true)
        }
      }
      .build()

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(NOTIF_ID, notif)
    }
  }

  companion object {
    const val KEY_ID = "downloader.id"
    const val TAG = "DownloadWorker"

    private const val PROGRESS_INTERVAL_MS = 1_000L
    private const val NOTIF_CHANNEL_ID = "jellyfuse.downloads"
    private const val NOTIF_ID = 42

    private val httpClient: OkHttpClient by lazy {
      OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS) // no wall-clock cap; long video files
        .retryOnConnectionFailure(true)
        .build()
    }

    fun ensureChannel(ctx: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (mgr.getNotificationChannel(NOTIF_CHANNEL_ID) != null) return
      val channel = NotificationChannel(
        NOTIF_CHANNEL_ID,
        "Downloads",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Shows progress of offline downloads"
      }
      mgr.createNotificationChannel(channel)
    }
  }
}
