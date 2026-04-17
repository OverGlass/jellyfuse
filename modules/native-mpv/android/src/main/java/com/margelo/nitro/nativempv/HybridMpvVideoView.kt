package com.margelo.nitro.nativempv

import android.content.Context
import android.graphics.Color
import android.view.View
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Phase A stub — renders an opaque black View as a placeholder for the
 * libmpv-backed SurfaceView. attach/detach are no-ops because there is
 * no render context to wire up yet. The overlay in `PlayerScreen` still
 * surfaces the "Playback unavailable on Android" error because the
 * `HybridNativeMpv` stub fires `onError` on subscribe.
 */
@DoNotStrip
class HybridMpvVideoView(context: Context) : HybridMpvVideoViewSpec() {

  override val view: View = View(context).apply {
    setBackgroundColor(Color.BLACK)
  }

  override fun attachPlayer(instanceId: String) {
    // No-op until Phase C stands up `mpv_render_context`.
  }

  override fun detachPlayer() {
    // No-op.
  }

  companion object {
    init {
      System.loadLibrary("NativeMpv")
    }
  }
}
