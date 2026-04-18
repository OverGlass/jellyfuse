package com.margelo.nitro.nativempv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Nitro HybridView — ports the iOS `HybridMpvVideoView` (wraps
 * `MpvGLView` under the `CAEAGLLayer`). On Android the surface is
 * an [MpvSurfaceView] that owns the `mpv_render_context`.
 *
 * The SurfaceView is returned directly from [view] because Fabric
 * sizes the React component's backing Android view via Yoga — any
 * children we add ourselves don't get laid out by Fabric (they'd
 * stay at 0×0). Keeping a single view avoids that pitfall.
 *
 * `attachPlayer` resolves the [HybridNativeMpv] by `instanceId` and
 * binds it to the existing SurfaceView; the render context is then
 * created as soon as both the player handle and the surface are
 * ready (whichever happens last).
 */
@DoNotStrip
@Keep
class HybridMpvVideoView(private val context: Context) : HybridMpvVideoViewSpec() {

    private val surfaceView: MpvSurfaceView = MpvSurfaceView(context)
    private val mainHandler = Handler(Looper.getMainLooper())

    override val view: View
        get() = surfaceView

    override fun attachPlayer(instanceId: String) {
        Log.i(TAG, "attachPlayer($instanceId)")
        if (!MpvBridge.isLinked) {
            Log.w(TAG, "attachPlayer called but libmpv not linked")
            return
        }
        val player = HybridNativeMpv.instance(instanceId)
        if (player == null) {
            Log.w(TAG, "No HybridNativeMpv for instanceId=$instanceId")
            return
        }
        runOnMain { surfaceView.setPlayer(player) }
    }

    override fun detachPlayer() {
        Log.i(TAG, "detachPlayer")
        runOnMain { surfaceView.detach() }
    }

    private inline fun runOnMain(crossinline block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) block()
        else mainHandler.post { block() }
    }

    companion object {
        private const val TAG = "HybridMpvVideoView"

        init {
            System.loadLibrary("NativeMpv")
        }
    }
}
