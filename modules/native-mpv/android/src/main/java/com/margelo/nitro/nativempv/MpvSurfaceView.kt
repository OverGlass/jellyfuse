package com.margelo.nitro.nativempv

import android.content.Context
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView

/**
 * SurfaceView dedicated to mpv rendering. Ports the Swift
 * `MpvGLView` (ios/HybridMpvVideoView.swift) — on Android we use a
 * plain `SurfaceView` with `setZOrderMediaOverlay(true)` so the RN
 * overlay chrome (controls, subtitles, trickplay) composites above
 * the video plane.
 *
 * The SurfaceHolder lifecycle drives the mpv_render_context:
 *   - surfaceCreated → `MpvBridge.nativeRenderContextCreate`
 *   - surfaceChanged → `nativeRenderContextResize`
 *   - surfaceDestroyed → `nativeRenderContextFree` (BEFORE the
 *     Surface becomes invalid; mpv docs require freeing the
 *     render context before its GL context goes away).
 *
 * Render pacing: mpv signals "new frame ready" through the
 * `render-update` callback → `MpvBridge.onRenderUpdateFromNative`.
 * We schedule a Choreographer frame from there, debounced so a
 * burst of updates collapses to a single vsync render. Mirrors the
 * iOS `CADisplayLink + needsRender` pattern.
 */
internal class MpvSurfaceView(
    context: Context,
    private val player: HybridNativeMpv,
) : SurfaceView(context), SurfaceHolder.Callback, Choreographer.FrameCallback {

    private var rsHandle: Long = 0L
    private var pendingFrame = false
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
        setBackgroundColor(Color.BLACK)
        // Video plane below RN overlays (subtitles, scrubber, chapters).
        setZOrderMediaOverlay(true)
        holder.addCallback(this)
    }

    // ── Surface lifecycle ─────────────────────────────────────────────────

    override fun surfaceCreated(holder: SurfaceHolder) {
        val mpvHandle = player.mpvHandle
        if (mpvHandle == 0L) {
            Log.w(TAG, "surfaceCreated but player has no mpv handle")
            return
        }
        rsHandle = MpvBridge.nativeRenderContextCreate(mpvHandle, holder.surface)
        if (rsHandle == 0L) {
            Log.e(TAG, "nativeRenderContextCreate returned null")
            return
        }
        player.onRenderContextAttached()
        MpvBridge.registerRenderUpdateListener(rsHandle, ::onRenderUpdate)
        MpvBridge.nativeRenderContextSetUpdateCallback(rsHandle, true)
        // Force the first frame once decoded — mpv won't fire the
        // update callback until there's a frame to render.
        scheduleRender()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        if (rsHandle != 0L) {
            MpvBridge.nativeRenderContextResize(rsHandle, width, height)
            scheduleRender()
        }
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        detach()
    }

    // ── Render-update fan-in ──────────────────────────────────────────────

    private fun onRenderUpdate() {
        // Called from mpv's render worker thread — hop to main to
        // schedule a Choreographer frame.
        mainHandler.post(::scheduleRender)
    }

    private fun scheduleRender() {
        if (pendingFrame || rsHandle == 0L) return
        pendingFrame = true
        Choreographer.getInstance().postFrameCallback(this)
    }

    override fun doFrame(frameTimeNanos: Long) {
        pendingFrame = false
        val rs = rsHandle
        if (rs == 0L) return
        val flags = MpvBridge.nativeRenderContextUpdate(rs)
        // MPV_RENDER_UPDATE_FRAME = 1 — only render when a new frame
        // is ready, matching the iOS `needsRender` gate.
        if (flags and 0x1L == 0L) return
        MpvBridge.nativeRenderFrame(rs)
    }

    // ── Teardown ──────────────────────────────────────────────────────────

    fun detach() {
        if (rsHandle == 0L) return
        Choreographer.getInstance().removeFrameCallback(this)
        MpvBridge.nativeRenderContextSetUpdateCallback(rsHandle, false)
        MpvBridge.unregisterRenderUpdateListener(rsHandle)
        MpvBridge.nativeRenderContextFree(rsHandle)
        rsHandle = 0L
        player.onRenderContextDetached()
    }

    companion object {
        private const val TAG = "MpvSurfaceView"
    }
}
