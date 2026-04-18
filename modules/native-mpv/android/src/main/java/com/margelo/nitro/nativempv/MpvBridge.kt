package com.margelo.nitro.nativempv

import android.view.Surface
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip

/**
 * Thin Kotlin wrapper around [libmpv][] accessed via `mpv_jni.cpp`.
 *
 * When the native library was compiled without libmpv (stubs-only
 * build — see `scripts/fetch-libmpv-android.sh`), [isLinked] returns
 * false and every other method is a no-op that returns a sentinel.
 * Callers (HybridNativeMpv) check [isLinked] at construction time
 * and fall back to throwing `mpv.not_implemented` so the player
 * screen still renders a friendly "Playback Unavailable" overlay.
 *
 * The two static wakeup callbacks ([onWakeupFromNative],
 * [onRenderUpdateFromNative]) are invoked from libmpv's worker
 * threads. They dispatch to per-handle listeners registered by
 * [registerWakeupListener] / [registerRenderUpdateListener] so the
 * Kotlin-side event thread / Choreographer can react.
 */
@DoNotStrip
@Keep
internal object MpvBridge {
    init {
        System.loadLibrary("NativeMpv")
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────
    external fun nativeIsLinked(): Boolean
    external fun nativeCreate(): Long
    external fun nativeInitialize(handle: Long): Int
    external fun nativeTerminate(handle: Long)
    external fun nativeWakeup(handle: Long)

    // ── Commands / properties ─────────────────────────────────────────────
    external fun nativeCommand(handle: Long, args: Array<String>): Int
    external fun nativeSetOptionString(handle: Long, name: String, value: String): Int
    external fun nativeSetPropertyString(handle: Long, name: String, value: String): Int
    external fun nativeGetPropertyString(handle: Long, name: String): String?
    external fun nativeObserveProperty(handle: Long, userdata: Long, name: String, format: Int): Int
    external fun nativeErrorString(code: Int): String
    external fun nativeRequestLogMessages(handle: Long, level: String): Int

    // ── Events ────────────────────────────────────────────────────────────
    external fun nativeWaitEvent(handle: Long, timeout: Double): MpvEvent?

    // ── Render context ────────────────────────────────────────────────────
    external fun nativeRenderContextCreate(handle: Long, surface: Surface): Long
    external fun nativeRenderContextFree(rsHandle: Long)
    external fun nativeRenderContextResize(rsHandle: Long, width: Int, height: Int)
    external fun nativeRenderFrame(rsHandle: Long)
    external fun nativeRenderContextUpdate(rsHandle: Long): Long
    external fun nativeRenderContextSetUpdateCallback(rsHandle: Long, enabled: Boolean)

    // ── Lazy-cached linked flag ───────────────────────────────────────────
    //
    // Checked on the HybridNativeMpv init path; never changes at runtime.
    val isLinked: Boolean by lazy {
        try {
            nativeIsLinked()
        } catch (_: UnsatisfiedLinkError) {
            false
        }
    }

    // ── Wakeup / render-update fan-out ────────────────────────────────────
    //
    // libmpv calls these from worker threads; we look up the subscriber
    // by handle and notify.

    private val wakeupListeners = mutableMapOf<Long, () -> Unit>()
    private val renderUpdateListeners = mutableMapOf<Long, () -> Unit>()
    private val lock = Any()

    fun registerWakeupListener(handle: Long, listener: () -> Unit) {
        synchronized(lock) { wakeupListeners[handle] = listener }
    }

    fun unregisterWakeupListener(handle: Long) {
        synchronized(lock) { wakeupListeners.remove(handle) }
    }

    fun registerRenderUpdateListener(rsHandle: Long, listener: () -> Unit) {
        synchronized(lock) { renderUpdateListeners[rsHandle] = listener }
    }

    fun unregisterRenderUpdateListener(rsHandle: Long) {
        synchronized(lock) { renderUpdateListeners.remove(rsHandle) }
    }

    /** Called from native code when mpv signals a wakeup for a handle. */
    @JvmStatic
    @DoNotStrip
    @Keep
    fun onWakeupFromNative(handle: Long) {
        val listener = synchronized(lock) { wakeupListeners[handle] }
        listener?.invoke()
    }

    /** Called from native code when mpv_render_context signals "new frame available". */
    @JvmStatic
    @DoNotStrip
    @Keep
    fun onRenderUpdateFromNative(rsHandle: Long) {
        val listener = synchronized(lock) { renderUpdateListeners[rsHandle] }
        listener?.invoke()
    }
}

/**
 * Lightweight marshalling struct populated by [MpvBridge.nativeWaitEvent].
 * Fields track the subset of `mpv_event` we actually consume in Kotlin
 * (event id + the common property-change payload shapes). Extending
 * the set is a matter of adding fields here and filling them in
 * `mpv_jni.cpp :: nativeWaitEvent`.
 */
@DoNotStrip
@Keep
internal data class MpvEvent(
    @JvmField val eventId: Int,
    @JvmField val errorCode: Int,
    @JvmField val propertyName: String?,
    @JvmField val propertyFormat: Int,
    @JvmField val propertyDouble: Double,
    @JvmField val propertyFlag: Boolean,
    @JvmField val propertyString: String?,
)

/** Values mirror `enum mpv_event_id` in mpv/client.h. */
internal object MpvEventId {
    const val NONE = 0
    const val SHUTDOWN = 1
    const val LOG_MESSAGE = 2
    const val GET_PROPERTY_REPLY = 3
    const val SET_PROPERTY_REPLY = 4
    const val COMMAND_REPLY = 5
    const val START_FILE = 6
    const val END_FILE = 7
    const val FILE_LOADED = 8
    const val IDLE = 11
    const val TICK = 14
    const val CLIENT_MESSAGE = 16
    const val VIDEO_RECONFIG = 17
    const val AUDIO_RECONFIG = 18
    const val SEEK = 20
    const val PLAYBACK_RESTART = 21
    const val PROPERTY_CHANGE = 22
    const val QUEUE_OVERFLOW = 24
    const val HOOK = 25
}

/** Values mirror `enum mpv_format` in mpv/client.h. */
internal object MpvFormat {
    const val NONE = 0
    const val STRING = 1
    const val OSD_STRING = 2
    const val FLAG = 3
    const val INT64 = 4
    const val DOUBLE = 5
    const val NODE = 6
}
