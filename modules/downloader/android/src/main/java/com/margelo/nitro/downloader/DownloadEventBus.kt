package com.margelo.nitro.downloader

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * Process-wide event channel between `DownloadWorker` (writer) and
 * `HybridDownloader` (reader, which fans out to JS listeners).
 *
 * Using a SharedFlow with `extraBufferCapacity=64` + DROP_OLDEST gives us
 * lossy-but-ordered semantics: if JS is momentarily slow we drop stale
 * progress ticks rather than stalling the worker. Terminal state events
 * (done/failed) are emitted rarely so the drop risk is negligible; the
 * JS side also re-reads the manifest on mount so nothing is permanently
 * lost.
 *
 * The Swift impl uses per-instance DispatchQueue-guarded arrays of
 * `Subscription<Callback>` callbacks. On Android, WorkManager spawns the
 * worker in a separate process-local context and holds it for the
 * download duration, so a shared bus indirects cleanly between the two.
 */
internal sealed class DownloadEvent {
  data class Progress(
    val id: String,
    val bytesDownloaded: Double,
    val bytesTotal: Double,
  ) : DownloadEvent()

  data class StateChange(
    val id: String,
    val state: NativeDownloadState,
  ) : DownloadEvent()
}

internal object DownloadEventBus {
  val events: MutableSharedFlow<DownloadEvent> = MutableSharedFlow(
    replay = 0,
    extraBufferCapacity = 64,
    onBufferOverflow = BufferOverflow.DROP_OLDEST,
  )

  fun emitProgress(id: String, bytesDownloaded: Double, bytesTotal: Double) {
    events.tryEmit(DownloadEvent.Progress(id, bytesDownloaded, bytesTotal))
  }

  fun emitStateChange(id: String, state: NativeDownloadState) {
    events.tryEmit(DownloadEvent.StateChange(id, state))
  }
}
