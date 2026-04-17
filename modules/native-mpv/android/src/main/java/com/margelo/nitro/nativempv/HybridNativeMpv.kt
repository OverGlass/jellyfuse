package com.margelo.nitro.nativempv

import android.util.Log
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

/**
 * libmpv-backed player. Ports the Swift implementation at
 * `ios/HybridNativeMpv.swift` — same listener-array pattern, same
 * property observers, same load flow. Android-specific bits:
 *
 *   - `vo=gpu-next`, `hwdec=mediacodec-copy`, `gpu-context=android`,
 *     `opengl-es=yes` (iOS uses `vo=libmpv` + `videotoolbox-copy`).
 *   - Audio focus via [AudioFocusController] instead of
 *     AVAudioSession.
 *   - Event pump is a dedicated thread in [MpvEventThread] instead
 *     of a Swift `Thread`.
 *
 * ### Stubs-only fallback
 *
 * When the native library was compiled without libmpv linked
 * (see `MpvBridge.isLinked`), construction fails fast: every
 * method throws `mpv.not_implemented` and the listener registration
 * path fires `onError("mpv.not_implemented")` once so the player
 * screen can show the "Playback Unavailable" overlay instead of
 * hanging forever.
 */
@DoNotStrip
@Keep
class HybridNativeMpv : HybridNativeMpvSpec() {

    override val instanceId: String = UUID.randomUUID().toString()

    /** Raw mpv_handle pointer — exposed to [MpvSurfaceView.surfaceCreated]. */
    internal var mpvHandle: Long = 0L
        private set

    private val isShuttingDown = AtomicBoolean(false)
    private var eventThread: MpvEventThread? = null
    private var audioFocus: AudioFocusController? = null
    private var pendingPlay = false

    // Cached property values so progress callbacks can fire with both
    // position + duration (mpv delivers the two as separate events).
    private var currentPosition: Double = 0.0
    private var currentDuration: Double = 0.0

    // Listener storage — matches the Swift `Subscription` pattern so
    // `remove()` is O(n) identity-based removal. CopyOnWrite gives us
    // the "snapshot before fire" semantics without extra copies.
    private class Sub<T : Any>(val cb: T)
    private val progressSubs = CopyOnWriteArrayList<Sub<(Double, Double) -> Unit>>()
    private val stateSubs = CopyOnWriteArrayList<Sub<(MpvPlaybackState) -> Unit>>()
    private val endedSubs = CopyOnWriteArrayList<Sub<() -> Unit>>()
    private val errorSubs = CopyOnWriteArrayList<Sub<(String) -> Unit>>()
    private val tracksSubs = CopyOnWriteArrayList<Sub<(Array<MpvAudioTrack>, Array<MpvSubtitleTrack>) -> Unit>>()
    private val bufferingSubs = CopyOnWriteArrayList<Sub<(Boolean, Double) -> Unit>>()

    init {
        if (MpvBridge.isLinked) {
            try {
                createHandle()
                instances[instanceId] = this
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to create mpv handle", t)
                mpvHandle = 0L
            }
        } else {
            Log.w(TAG, "libmpv not linked — falling back to stubs-only")
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    override fun load(streamUrl: String, options: MpvLoadOptions) {
        requireLinked()
        val mpv = mpvHandle
        if (mpv == 0L) throw RuntimeException("mpv.invalid_handle")

        Log.i(TAG, "load: $streamUrl")

        // Pre-loadfile options. `start` must be set before loadfile;
        // speed/volume/user-agent are harmless before load.
        options.startPositionSeconds?.let {
            setPropertyOrThrow("start", String.format("%.3f", it))
        }
        options.playbackRate?.let { setPropertyOrThrow("speed", it.toString()) }
        options.volume?.let { setPropertyOrThrow("volume", it.toString()) }
        options.userAgent?.let { setPropertyOrThrow("user-agent", it) }

        runCommandOrThrow(arrayOf("loadfile", streamUrl))

        options.externalSubtitles?.forEach { sub ->
            val args = mutableListOf("sub-add", sub.uri, "auto")
            sub.title?.let { args.add(it) }
            sub.language?.let {
                if (args.size == 3) args.add("") // title slot
                args.add(it)
            }
            try {
                runCommandOrThrow(args.toTypedArray())
            } catch (t: Throwable) {
                Log.w(TAG, "sub-add failed for ${sub.uri}: ${t.message}")
            }
        }

        options.audioTrackIndex?.let {
            MpvBridge.nativeSetPropertyString(mpv, "aid", it.toInt().toString())
        }
        options.subtitleTrackIndex?.let {
            MpvBridge.nativeSetPropertyString(mpv, "sid", it.toInt().toString())
        }
        pendingPlay = true
    }

    override fun release() {
        tearDown()
    }

    // ── Transport ─────────────────────────────────────────────────────────

    override fun play() {
        requireLinked()
        setPropertyOrThrow("pause", "no")
        audioFocus?.requestFocus()
    }

    override fun pause() {
        requireLinked()
        setPropertyOrThrow("pause", "yes")
    }

    override fun seek(positionSeconds: Double) {
        requireLinked()
        runCommandOrThrow(arrayOf("seek", positionSeconds.toString(), "absolute"))
    }

    // ── Tracks / rate / volume ────────────────────────────────────────────

    override fun setAudioTrack(trackId: Double) {
        requireLinked()
        setPropertyOrThrow("aid", trackId.toInt().toString())
    }

    override fun setSubtitleTrack(trackId: Double) {
        requireLinked()
        setPropertyOrThrow("sid", trackId.toInt().toString())
    }

    override fun disableSubtitles() {
        requireLinked()
        setPropertyOrThrow("sid", "no")
    }

    override fun setRate(rate: Double) {
        requireLinked()
        val clamped = rate.coerceIn(0.25, 3.0)
        setPropertyOrThrow("speed", clamped.toString())
    }

    override fun setVolume(volume: Double) {
        requireLinked()
        val clamped = volume.coerceIn(0.0, 100.0)
        setPropertyOrThrow("volume", clamped.toString())
    }

    // ── Generic property bridge ───────────────────────────────────────────

    override fun setProperty(name: String, value: String) {
        requireLinked()
        setPropertyOrThrow(name, value)
    }

    override fun getProperty(name: String): String {
        if (!MpvBridge.isLinked || mpvHandle == 0L) return ""
        return MpvBridge.nativeGetPropertyString(mpvHandle, name) ?: ""
    }

    // ── Listener registration ─────────────────────────────────────────────

    override fun addProgressListener(
        onProgress: (positionSeconds: Double, durationSeconds: Double) -> Unit,
    ): MpvListener {
        val sub = Sub(onProgress)
        progressSubs.add(sub)
        return MpvListener(remove = { progressSubs.remove(sub) })
    }

    override fun addStateChangeListener(
        onStateChange: (state: MpvPlaybackState) -> Unit,
    ): MpvListener {
        val sub = Sub(onStateChange)
        stateSubs.add(sub)
        return MpvListener(remove = { stateSubs.remove(sub) })
    }

    override fun addEndedListener(onEnded: () -> Unit): MpvListener {
        val sub = Sub(onEnded)
        endedSubs.add(sub)
        return MpvListener(remove = { endedSubs.remove(sub) })
    }

    override fun addErrorListener(onError: (message: String) -> Unit): MpvListener {
        val sub = Sub(onError)
        errorSubs.add(sub)
        // Stubs-only fallback: surface the sentinel immediately so the
        // player screen can render the "Playback Unavailable" overlay.
        if (!MpvBridge.isLinked) onError("mpv.not_implemented")
        return MpvListener(remove = { errorSubs.remove(sub) })
    }

    override fun addTracksListener(
        onTracksDiscovered: (audio: Array<MpvAudioTrack>, subtitle: Array<MpvSubtitleTrack>) -> Unit,
    ): MpvListener {
        val sub = Sub(onTracksDiscovered)
        tracksSubs.add(sub)
        return MpvListener(remove = { tracksSubs.remove(sub) })
    }

    override fun addBufferingListener(
        onBuffering: (isBuffering: Boolean, progress: Double) -> Unit,
    ): MpvListener {
        val sub = Sub(onBuffering)
        bufferingSubs.add(sub)
        return MpvListener(remove = { bufferingSubs.remove(sub) })
    }

    // ── SurfaceView attach hooks ──────────────────────────────────────────

    /** Called from [MpvSurfaceView] once mpv_render_context is ready. */
    internal fun onRenderContextAttached() {
        val mpv = mpvHandle
        if (mpv == 0L) return
        // Enable video + unpause. mpv was initialized with pause=yes
        // + vid=no so libmpv wouldn't try to open its own window
        // before the render context existed. Now both can flip on.
        MpvBridge.nativeSetPropertyString(mpv, "vid", "auto")
        if (pendingPlay) {
            MpvBridge.nativeSetPropertyString(mpv, "pause", "no")
            pendingPlay = false
        }
    }

    /** Called from [MpvSurfaceView.detach]. */
    internal fun onRenderContextDetached() {
        val mpv = mpvHandle
        if (mpv == 0L) return
        MpvBridge.nativeSetPropertyString(mpv, "vid", "no")
    }

    // ── Private: handle setup + teardown ──────────────────────────────────

    private fun createHandle() {
        val mpv = MpvBridge.nativeCreate()
        if (mpv == 0L) {
            Log.e(TAG, "mpv_create returned null")
            return
        }

        // Android-specific defaults. `vo=gpu-next` is the preferred
        // video output on mpv >= 0.37 and handles HDR tone-mapping.
        MpvBridge.nativeSetOptionString(mpv, "vo", "gpu-next")
        MpvBridge.nativeSetOptionString(mpv, "gpu-context", "android")
        MpvBridge.nativeSetOptionString(mpv, "opengl-es", "yes")
        MpvBridge.nativeSetOptionString(mpv, "hwdec", "mediacodec-copy")
        // Start muted-of-video until the render context arrives, same
        // as the iOS flow. SurfaceView will flip vid=auto + pause=no.
        MpvBridge.nativeSetOptionString(mpv, "vid", "no")
        MpvBridge.nativeSetOptionString(mpv, "pause", "yes")
        MpvBridge.nativeSetOptionString(mpv, "audio-device", "auto")
        MpvBridge.nativeSetOptionString(mpv, "cache", "yes")
        MpvBridge.nativeSetOptionString(mpv, "demuxer-max-bytes", "50MiB")
        MpvBridge.nativeSetOptionString(mpv, "demuxer-max-back-bytes", "25MiB")

        val rc = MpvBridge.nativeInitialize(mpv)
        if (rc < 0) {
            Log.e(TAG, "mpv_initialize failed: $rc ${MpvBridge.nativeErrorString(rc)}")
            MpvBridge.nativeTerminate(mpv)
            return
        }

        // Same observer set as the Swift code.
        MpvBridge.nativeObserveProperty(mpv, 1, "playback-time", MpvFormat.DOUBLE)
        MpvBridge.nativeObserveProperty(mpv, 2, "duration", MpvFormat.DOUBLE)
        MpvBridge.nativeObserveProperty(mpv, 3, "pause", MpvFormat.FLAG)
        MpvBridge.nativeObserveProperty(mpv, 4, "eof-reached", MpvFormat.FLAG)
        MpvBridge.nativeObserveProperty(mpv, 5, "track-list", MpvFormat.NODE)
        MpvBridge.nativeObserveProperty(mpv, 6, "paused-for-cache", MpvFormat.FLAG)
        MpvBridge.nativeObserveProperty(mpv, 7, "cache-buffering-state", MpvFormat.DOUBLE)

        mpvHandle = mpv
        MpvBridge.registerWakeupListener(mpv) { /* wakeup is in-thread; no-op */ }

        eventThread = MpvEventThread(mpv, ::onEvent).also { it.start() }

        val ctx = NitroModules.applicationContext
        if (ctx != null) {
            audioFocus = AudioFocusController(
                context = ctx,
                onPause = {
                    try {
                        if (mpvHandle != 0L) MpvBridge.nativeSetPropertyString(mpvHandle, "pause", "yes")
                    } catch (_: Throwable) {}
                },
                onResume = {
                    try {
                        if (mpvHandle != 0L && !pendingPlay) MpvBridge.nativeSetPropertyString(mpvHandle, "pause", "no")
                    } catch (_: Throwable) {}
                },
            )
        }
    }

    private fun tearDown() {
        if (!isShuttingDown.compareAndSet(false, true)) return
        val mpv = mpvHandle
        instances.remove(instanceId)
        eventThread?.stop()
        eventThread = null
        audioFocus?.abandonFocus()
        audioFocus = null
        progressSubs.clear()
        stateSubs.clear()
        endedSubs.clear()
        errorSubs.clear()
        tracksSubs.clear()
        bufferingSubs.clear()
        if (mpv != 0L) {
            MpvBridge.unregisterWakeupListener(mpv)
            MpvBridge.nativeTerminate(mpv)
        }
        mpvHandle = 0L
    }

    // ── Event dispatch ────────────────────────────────────────────────────

    private fun onEvent(event: MpvEvent) {
        when (event.eventId) {
            MpvEventId.SHUTDOWN -> return
            MpvEventId.END_FILE -> {
                fireEnded()
                fireState(MpvPlaybackState.ENDED)
            }
            MpvEventId.PROPERTY_CHANGE -> handlePropertyChange(event)
        }
    }

    private fun handlePropertyChange(event: MpvEvent) {
        val name = event.propertyName ?: return
        when (name) {
            "playback-time" -> {
                if (event.propertyFormat != MpvFormat.DOUBLE) return
                currentPosition = event.propertyDouble
                progressSubs.forEach { it.cb(currentPosition, currentDuration) }
            }
            "duration" -> {
                if (event.propertyFormat != MpvFormat.DOUBLE) return
                currentDuration = event.propertyDouble
            }
            "pause" -> {
                if (event.propertyFormat != MpvFormat.FLAG) return
                val state = if (event.propertyFlag) MpvPlaybackState.PAUSED else MpvPlaybackState.PLAYING
                fireState(state)
            }
            "eof-reached" -> {
                if (event.propertyFormat != MpvFormat.FLAG) return
                if (event.propertyFlag) {
                    fireEnded()
                    fireState(MpvPlaybackState.ENDED)
                }
            }
            "paused-for-cache" -> {
                if (event.propertyFormat != MpvFormat.FLAG) return
                bufferingSubs.forEach { it.cb(event.propertyFlag, 0.0) }
            }
            "cache-buffering-state" -> {
                if (event.propertyFormat != MpvFormat.DOUBLE) return
                val progress = event.propertyDouble / 100.0
                bufferingSubs.forEach { it.cb(progress < 1.0, progress) }
            }
        }
    }

    private fun fireEnded() {
        endedSubs.forEach { it.cb() }
    }

    private fun fireState(state: MpvPlaybackState) {
        stateSubs.forEach { it.cb(state) }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun requireLinked() {
        if (!MpvBridge.isLinked) throw RuntimeException("mpv.not_implemented")
    }

    private fun setPropertyOrThrow(name: String, value: String) {
        val mpv = mpvHandle
        if (mpv == 0L) throw RuntimeException("mpv.invalid_handle")
        val rc = MpvBridge.nativeSetPropertyString(mpv, name, value)
        if (rc < 0) throw RuntimeException("mpv.set_property:$name:${MpvBridge.nativeErrorString(rc)}")
    }

    private fun runCommandOrThrow(args: Array<String>) {
        val mpv = mpvHandle
        if (mpv == 0L) throw RuntimeException("mpv.invalid_handle")
        val rc = MpvBridge.nativeCommand(mpv, args)
        if (rc < 0) throw RuntimeException("mpv.command:${args.firstOrNull() ?: "?"}:${MpvBridge.nativeErrorString(rc)}")
    }

    companion object {
        private const val TAG = "HybridNativeMpv"

        init {
            System.loadLibrary("NativeMpv")
        }

        /** Registry keyed by instanceId — used by [HybridMpvVideoView.attachPlayer]. */
        private val instances = ConcurrentHashMap<String, HybridNativeMpv>()

        fun instance(instanceId: String): HybridNativeMpv? = instances[instanceId]
    }
}
