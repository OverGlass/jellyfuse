package com.margelo.nitro.nativempv

import android.content.Context
import android.graphics.Color
import android.util.Log
import android.view.View
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Nitro HybridView — ports the iOS `HybridMpvVideoView` (wraps
 * `MpvGLView` under the `CAEAGLLayer`). On Android the surface is
 * an [MpvSurfaceView] that owns the `mpv_render_context`.
 *
 * `attachPlayer` looks up the [HybridNativeMpv] by `instanceId` and
 * swaps the plain black placeholder for the actual SurfaceView.
 * Keeping the placeholder around for the stubs-only case (libmpv
 * not linked) avoids adding null-guards everywhere — the view is
 * still a valid [View] either way.
 */
@DoNotStrip
@Keep
class HybridMpvVideoView(private val context: Context) : HybridMpvVideoViewSpec() {

    private val placeholder: View = View(context).apply { setBackgroundColor(Color.BLACK) }
    private var surfaceView: MpvSurfaceView? = null
    private var currentView: View = placeholder

    override val view: View
        get() = currentView

    override fun attachPlayer(instanceId: String) {
        if (!MpvBridge.isLinked) {
            Log.w(TAG, "attachPlayer called but libmpv not linked")
            return
        }
        val player = HybridNativeMpv.instance(instanceId)
        if (player == null) {
            Log.w(TAG, "No HybridNativeMpv for instanceId=$instanceId")
            return
        }
        if (surfaceView != null) return

        val sv = MpvSurfaceView(context, player)
        surfaceView = sv
        currentView = sv
    }

    override fun detachPlayer() {
        surfaceView?.detach()
        surfaceView = null
        currentView = placeholder
    }

    companion object {
        private const val TAG = "HybridMpvVideoView"

        init {
            System.loadLibrary("NativeMpv")
        }
    }
}
