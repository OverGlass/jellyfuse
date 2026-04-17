package com.margelo.nitro.nativempv

import com.facebook.proguard.annotations.DoNotStrip
import java.util.UUID

/**
 * Phase A stub — the iOS Swift implementation wraps MPVKit; the Android
 * port over libmpv lands in Phase C. Every method throws a typed error
 * so JS consumers can render an "unavailable on Android" state without
 * crashing the app.
 *
 * Error codes (stable across native platforms):
 *   - `mpv.not_implemented` — method not yet ported on Android.
 *
 * `instanceId` is still returned so `PlayerScreen` can keep its
 * `attachPlayer(id)` dance running without null-guards.
 */
@DoNotStrip
class HybridNativeMpv : HybridNativeMpvSpec() {

  override val instanceId: String = UUID.randomUUID().toString()

  override fun load(streamUrl: String, options: MpvLoadOptions) {
    throw Error("mpv.not_implemented")
  }

  override fun release() {
    // No-op — the JS hook always calls this in cleanup; throwing would
    // poison unmount paths. Safe to ignore for the stub.
  }

  override fun play() {
    throw Error("mpv.not_implemented")
  }

  override fun pause() {
    throw Error("mpv.not_implemented")
  }

  override fun seek(positionSeconds: Double) {
    throw Error("mpv.not_implemented")
  }

  override fun setAudioTrack(trackId: Double) {
    throw Error("mpv.not_implemented")
  }

  override fun setSubtitleTrack(trackId: Double) {
    throw Error("mpv.not_implemented")
  }

  override fun disableSubtitles() {
    throw Error("mpv.not_implemented")
  }

  override fun setRate(rate: Double) {
    throw Error("mpv.not_implemented")
  }

  override fun setVolume(volume: Double) {
    throw Error("mpv.not_implemented")
  }

  override fun setProperty(name: String, value: String) {
    throw Error("mpv.not_implemented")
  }

  override fun getProperty(name: String): String {
    return ""
  }

  override fun addProgressListener(
    onProgress: (positionSeconds: Double, durationSeconds: Double) -> Unit
  ): MpvListener {
    return MpvListener(remove = {})
  }

  override fun addStateChangeListener(
    onStateChange: (state: MpvPlaybackState) -> Unit
  ): MpvListener {
    return MpvListener(remove = {})
  }

  override fun addEndedListener(onEnded: () -> Unit): MpvListener {
    return MpvListener(remove = {})
  }

  override fun addErrorListener(onError: (message: String) -> Unit): MpvListener {
    // Fire once so the player screen immediately renders the error
    // overlay instead of hanging on "loading" forever. Matches the
    // contract for "could not start playback".
    onError("mpv.not_implemented")
    return MpvListener(remove = {})
  }

  override fun addTracksListener(
    onTracksDiscovered: (audio: Array<MpvAudioTrack>, subtitle: Array<MpvSubtitleTrack>) -> Unit
  ): MpvListener {
    return MpvListener(remove = {})
  }

  override fun addBufferingListener(
    onBuffering: (isBuffering: Boolean, progress: Double) -> Unit
  ): MpvListener {
    return MpvListener(remove = {})
  }

  companion object {
    init {
      System.loadLibrary("NativeMpv")
    }
  }
}
