package com.margelo.nitro.nativempv

import android.os.HandlerThread
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Background thread pumping `mpv_wait_event(-1)` for one player
 * handle. Ports the Swift event loop in
 * `ios/HybridNativeMpv.swift:eventLoop()` to Android.
 *
 * The thread blocks inside `nativeWaitEvent`; libmpv posts a wakeup
 * whenever an event is ready OR when the client calls `mpv_wakeup`
 * (used on teardown so the loop exits promptly).
 */
internal class MpvEventThread(
    private val handle: Long,
    private val onEvent: (MpvEvent) -> Unit,
) {
    private val thread = HandlerThread(THREAD_NAME, android.os.Process.THREAD_PRIORITY_URGENT_DISPLAY)
    private val running = AtomicBoolean(false)

    fun start() {
        if (!running.compareAndSet(false, true)) return
        thread.start()
        // We drive the loop ourselves on a plain Thread — HandlerThread
        // is overkill for a blocking pump, but starting it forces the
        // Looper prepare that libmpv-unrelated handlers posted from
        // this thread would need. Kept here to match the Swift
        // Thread+QoS pattern and to leave room for future Handler-
        // based work.
        Thread(::loop, "jellyfuse.native-mpv.events").apply {
            priority = Thread.NORM_PRIORITY + 1
            isDaemon = true
            start()
        }
    }

    fun stop() {
        if (!running.compareAndSet(true, false)) return
        // Unblock the pending mpv_wait_event so the loop can exit.
        MpvBridge.nativeWakeup(handle)
        thread.quitSafely()
    }

    private fun loop() {
        while (running.get()) {
            val event = try {
                MpvBridge.nativeWaitEvent(handle, -1.0)
            } catch (t: Throwable) {
                Log.e(TAG, "nativeWaitEvent threw", t)
                break
            } ?: continue

            try {
                onEvent(event)
            } catch (t: Throwable) {
                Log.e(TAG, "event handler threw", t)
            }

            if (event.eventId == MpvEventId.SHUTDOWN) break
        }
    }

    companion object {
        private const val TAG = "MpvEventThread"
        private const val THREAD_NAME = "jellyfuse.native-mpv.handler"
    }
}
