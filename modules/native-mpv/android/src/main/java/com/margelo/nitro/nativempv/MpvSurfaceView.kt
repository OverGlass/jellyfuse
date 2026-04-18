package com.margelo.nitro.nativempv

import android.content.Context
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.Surface
import android.view.TextureView

/**
 * TextureView dedicated to mpv rendering. We use TextureView (rather than
 * SurfaceView) because Fabric/React Native's new architecture does not
 * reliably propagate SurfaceView hole-punching through RN parent views
 * that paint opaque backgrounds (see `features/player/screens/player-screen.tsx`
 * — the screen container uses backgroundColor `#000`). TextureView composes
 * through HWUI like any other view, so RN overlays (subtitles, trickplay,
 * scrubber, chapters) sit above the video without z-order hacks.
 *
 * Cost: frames go through a GPU copy (SurfaceTexture) before compositing,
 * which slightly increases GPU/battery load vs SurfaceView's zero-copy path.
 * Acceptable for phone; revisit only if a specific profile shows it matters.
 *
 * Player is attached lazily via [setPlayer] because the Nitro
 * HybridView constructs the Android view before JS calls
 * `attachPlayer(instanceId)`. The texture lifecycle races with that:
 *   - if onSurfaceTextureAvailable fires first, we stash the Surface and wait
 *   - if setPlayer is called first, we wait for the texture to become ready
 *   - whichever happens second triggers `nativeRenderContextCreate`
 *
 * Texture lifecycle drives the mpv_render_context:
 *   - onSurfaceTextureAvailable → `MpvBridge.nativeRenderContextCreate`
 *   - onSurfaceTextureSizeChanged → `nativeRenderContextResize`
 *   - onSurfaceTextureDestroyed → `nativeRenderContextFree` (BEFORE
 *     releasing the SurfaceTexture; mpv docs require freeing the
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
) : TextureView(context), TextureView.SurfaceTextureListener, Choreographer.FrameCallback {

    private var player: HybridNativeMpv? = null
    private var rsHandle: Long = 0L
    private var pendingFrame = false
    private var texture: SurfaceTexture? = null
    private var surface: Surface? = null
    private var surfaceWidth = 0
    private var surfaceHeight = 0
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
        // TextureView doesn't accept setBackgroundColor — it throws
        // UnsupportedOperationException. Opaque flag is true by default;
        // the render path clears to black every frame (glClear in mpv).
        isOpaque = true
        surfaceTextureListener = this
    }

    // ── Player attachment ─────────────────────────────────────────────────

    fun setPlayer(player: HybridNativeMpv) {
        if (this.player === player) return
        if (this.player != null) detach()
        this.player = player
        if (surface != null) attachRenderContext()
    }

    // ── Texture lifecycle ─────────────────────────────────────────────────

    override fun onSurfaceTextureAvailable(tex: SurfaceTexture, width: Int, height: Int) {
        Log.i(TAG, "onSurfaceTextureAvailable ${width}x$height")
        texture = tex
        surface = Surface(tex)
        surfaceWidth = width
        surfaceHeight = height
        if (player != null) attachRenderContext()
    }

    override fun onSurfaceTextureSizeChanged(tex: SurfaceTexture, width: Int, height: Int) {
        Log.i(TAG, "onSurfaceTextureSizeChanged ${width}x$height")
        surfaceWidth = width
        surfaceHeight = height
        if (rsHandle != 0L) {
            MpvBridge.nativeRenderContextResize(rsHandle, width, height)
            scheduleRender()
        }
    }

    override fun onSurfaceTextureDestroyed(tex: SurfaceTexture): Boolean {
        Log.i(TAG, "onSurfaceTextureDestroyed")
        freeRenderContext()
        surface?.release()
        surface = null
        texture = null
        return true  // TextureView may release the SurfaceTexture
    }

    override fun onSurfaceTextureUpdated(tex: SurfaceTexture) {
        // Fires after each successful swap — nothing to do.
    }

    // ── Render-context lifecycle ──────────────────────────────────────────

    private fun attachRenderContext() {
        if (rsHandle != 0L) return
        val p = player ?: return
        val surf = surface ?: return
        val mpvHandle = p.mpvHandle
        Log.i(TAG, "attachRenderContext mpvHandle=$mpvHandle")
        if (mpvHandle == 0L) {
            Log.w(TAG, "attachRenderContext but player has no mpv handle")
            return
        }
        rsHandle = MpvBridge.nativeRenderContextCreate(mpvHandle, surf)
        Log.i(TAG, "nativeRenderContextCreate -> $rsHandle")
        if (rsHandle == 0L) {
            Log.e(TAG, "nativeRenderContextCreate returned null")
            return
        }
        p.onRenderContextAttached()
        MpvBridge.registerRenderUpdateListener(rsHandle, ::onRenderUpdate)
        MpvBridge.nativeRenderContextSetUpdateCallback(rsHandle, true)
        if (surfaceWidth > 0 && surfaceHeight > 0) {
            MpvBridge.nativeRenderContextResize(rsHandle, surfaceWidth, surfaceHeight)
        }
        scheduleRender()
    }

    // ── Render-update fan-in ──────────────────────────────────────────────

    private fun onRenderUpdate() {
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
        if (flags and 0x1L == 0L) return
        MpvBridge.nativeRenderFrame(rs)
    }

    // ── Teardown ──────────────────────────────────────────────────────────

    private fun freeRenderContext() {
        if (rsHandle == 0L) return
        Choreographer.getInstance().removeFrameCallback(this)
        MpvBridge.nativeRenderContextSetUpdateCallback(rsHandle, false)
        MpvBridge.unregisterRenderUpdateListener(rsHandle)
        MpvBridge.nativeRenderContextFree(rsHandle)
        rsHandle = 0L
        player?.onRenderContextDetached()
    }

    fun detach() {
        freeRenderContext()
        player = null
    }

    companion object {
        private const val TAG = "MpvSurfaceView"
    }
}
