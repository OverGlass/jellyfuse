package com.margelo.nitro.downloader

import com.facebook.proguard.annotations.DoNotStrip

/**
 * Phase A stub — the iOS Swift implementation already ships background
 * downloads; the Kotlin port lands in Phase B (WorkManager + OkHttp +
 * foreground service). Every method throws a typed error so the JS
 * consumer can render an "unavailable on Android" empty state without
 * crashing the app.
 *
 * Error codes (stable across native platforms):
 *   - `downloader.not_implemented` — method not yet ported on Android.
 *
 * The companion `init` loads the JNI library so Nitro can bind this
 * class to the C++ spec at registration time.
 */
@DoNotStrip
class HybridDownloader : HybridDownloaderSpec() {

  override fun enqueue(options: DownloadOptions): String {
    throw Error("downloader.not_implemented")
  }

  override fun pause(id: String) {
    throw Error("downloader.not_implemented")
  }

  override fun resume(id: String) {
    throw Error("downloader.not_implemented")
  }

  override fun cancel(id: String) {
    throw Error("downloader.not_implemented")
  }

  override fun remove(id: String) {
    throw Error("downloader.not_implemented")
  }

  override fun rebaseAllPaths(newDocumentDirectory: String) {
    // No-op on Android — Phase A has no manifests on disk to rebase.
    // Matches the iOS lifecycle contract (callable before Phase B lands).
  }

  override fun clearAll() {
    throw Error("downloader.not_implemented")
  }

  override fun list(): Array<NativeDownloadRecord> {
    // Return empty so useLocalDownloads() hydrates a clean empty list
    // instead of throwing on first render.
    return emptyArray()
  }

  override fun addProgressListener(
    onProgress: (id: String, bytesDownloaded: Double, bytesTotal: Double) -> Unit
  ): DownloaderListener {
    return DownloaderListener(remove = {})
  }

  override fun addStateChangeListener(
    onStateChange: (id: String, state: NativeDownloadState) -> Unit
  ): DownloaderListener {
    return DownloaderListener(remove = {})
  }

  companion object {
    init {
      System.loadLibrary("Downloader")
    }
  }
}
