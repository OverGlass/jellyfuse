//
//  HybridNativeMpv.swift
//  @jellyfuse/native-mpv — iOS Nitro hybrid object
//
//  Phase 3a: audio-only wiring. Creates an `mpv_handle`, runs the
//  event loop on a background thread, routes `MPV_EVENT_*` +
//  property observers to the JS listener closures stored in this
//  instance. No render context yet — Phase 3b plugs in
//  `mpv_render_context_create` + a Fabric view host.
//
//  Ports the property + command wiring pattern from
//  `crates/jf-module-player/src/mpv_video.rs` in the Rust reference
//  (the desktop/macOS code path, which is the simpler of the two —
//  no render context + no IOSurface bridge).
//

import AVFoundation
import Foundation
import Libmpv
import MediaPlayer
import NitroModules
import os.log
import UIKit

private let npLog = OSLog(subsystem: "com.jellyfuse.app", category: "NativeMpv")

// Phase 3 bitmap-sub shim entry points (see
// docs/native-video-pipeline.md). Pulled in via @_silgen_name so we
// don't need a modulemap / bridging header — the C functions live in
// FFmpegBridge.mm and expose an opaque-handle streaming API.
@_silgen_name("jf_ffmpeg_version_info")
private func jf_ffmpeg_version_info() -> UnsafePointer<CChar>?

@_silgen_name("jf_bitmap_sub_open")
private func jf_bitmap_sub_open(
    _ url: UnsafePointer<CChar>?,
    _ startSeconds: Double,
    _ requestedStreamIndex: Int32,
    _ userAgent: UnsafePointer<CChar>?,
) -> OpaquePointer?

@_silgen_name("jf_bitmap_sub_decode_next")
private func jf_bitmap_sub_decode_next(
    _ ctx: OpaquePointer?,
    _ outPtsSeconds: UnsafeMutablePointer<Double>,
    _ outDurationSeconds: UnsafeMutablePointer<Double>,
    _ outNumRects: UnsafeMutablePointer<Int32>,
    _ outX: UnsafeMutablePointer<Int32>,
    _ outY: UnsafeMutablePointer<Int32>,
    _ outWidth: UnsafeMutablePointer<Int32>,
    _ outHeight: UnsafeMutablePointer<Int32>,
    _ outRgba: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>,
) -> Int32

@_silgen_name("jf_bitmap_sub_seek")
private func jf_bitmap_sub_seek(_ ctx: OpaquePointer?, _ seconds: Double) -> Int32

@_silgen_name("jf_bitmap_sub_source_size")
private func jf_bitmap_sub_source_size(
    _ ctx: OpaquePointer?,
    _ outWidth: UnsafeMutablePointer<Int32>,
    _ outHeight: UnsafeMutablePointer<Int32>,
)

@_silgen_name("jf_bitmap_sub_cancel")
private func jf_bitmap_sub_cancel(_ ctx: OpaquePointer?)

@_silgen_name("jf_bitmap_sub_is_cancelled")
private func jf_bitmap_sub_is_cancelled(_ ctx: OpaquePointer?) -> Int32

@_silgen_name("jf_bitmap_sub_close")
private func jf_bitmap_sub_close(_ ctx: OpaquePointer?)

@_silgen_name("jf_bitmap_sub_free_rgba")
private func jf_bitmap_sub_free_rgba(_ rgba: UnsafeMutablePointer<UInt8>?)

// Phase 2a video-sidecar entry points (see
// docs/native-video-pipeline-phase-2.md). Same opaque-handle pattern as
// the bitmap-sub shim; decode_next/seek are Commit B placeholders.
@_silgen_name("jf_video_open")
private func jf_video_open(
    _ url: UnsafePointer<CChar>?,
    _ startSeconds: Double,
    _ userAgent: UnsafePointer<CChar>?,
) -> OpaquePointer?

@_silgen_name("jf_video_close")
private func jf_video_close(_ ctx: OpaquePointer?)

@_silgen_name("jf_video_cancel")
private func jf_video_cancel(_ ctx: OpaquePointer?)

@_silgen_name("jf_video_codec_id")
private func jf_video_codec_id(_ ctx: OpaquePointer?) -> Int32

@_silgen_name("jf_video_bits_per_sample")
private func jf_video_bits_per_sample(_ ctx: OpaquePointer?) -> Int32

@_silgen_name("jf_video_dimensions")
private func jf_video_dimensions(
    _ ctx: OpaquePointer?,
    _ outWidth: UnsafeMutablePointer<Int32>,
    _ outHeight: UnsafeMutablePointer<Int32>,
)

@_silgen_name("jf_video_color_info")
private func jf_video_color_info(
    _ ctx: OpaquePointer?,
    _ outPrimaries: UnsafeMutablePointer<Int32>,
    _ outTransfer: UnsafeMutablePointer<Int32>,
    _ outMatrix: UnsafeMutablePointer<Int32>,
    _ outRange: UnsafeMutablePointer<Int32>,
)

@_silgen_name("jf_video_hdr_mastering")
private func jf_video_hdr_mastering(
    _ ctx: OpaquePointer?,
    _ mastering: UnsafeMutablePointer<UInt32>,
) -> Int32

@_silgen_name("jf_video_hdr_cll")
private func jf_video_hdr_cll(
    _ ctx: OpaquePointer?,
    _ cll: UnsafeMutablePointer<UInt16>,
) -> Int32

@_silgen_name("jf_video_dolby_vision_profile")
private func jf_video_dolby_vision_profile(_ ctx: OpaquePointer?) -> Int32

@_silgen_name("jf_video_decode_next")
private func jf_video_decode_next(
    _ ctx: OpaquePointer?,
    _ timeoutSeconds: Double,
    _ outPixelBuffer: UnsafeMutablePointer<UnsafeMutableRawPointer?>,
    _ outPtsSeconds: UnsafeMutablePointer<Double>,
    _ outIsKeyframe: UnsafeMutablePointer<Int32>,
) -> Int32

@_silgen_name("jf_video_seek")
private func jf_video_seek(_ ctx: OpaquePointer?, _ seconds: Double) -> Int32

@_silgen_name("jf_video_format_description")
private func jf_video_format_description(_ ctx: OpaquePointer?) -> UnsafeMutableRawPointer?

@_silgen_name("jf_video_pixel_format")
private func jf_video_pixel_format(_ ctx: OpaquePointer?) -> UInt32

// MARK: - HybridNativeMpv

/// `NativeMpv` hybrid object — one instance per player session.
///
/// The generated `HybridNativeMpvSpec` protocol is produced by
/// `nitrogen` from `src/NativeMpv.nitro.ts`. Run
/// `bun run nitrogen` in this package to regenerate it after spec
/// edits; the regenerated files land under
/// `modules/native-mpv/nitrogen/generated/ios`.
///
/// `import Libmpv` resolves via the custom modulemap at
/// `ios/Libmpv/module.modulemap` + the podspec's
/// `SWIFT_INCLUDE_PATHS`. The headers live in the vendored
/// `vendor/ios/mpvkit-{device,simulator}/include/mpv/`.
public final class HybridNativeMpv: HybridNativeMpvSpec {
    // MARK: Static instance registry

    /// Registry used by `MpvVideoView` to look up a player by ID.
    private static var instances: [String: HybridNativeMpv] = [:]

    static func instance(for id: String) -> HybridNativeMpv? {
        return instances[id]
    }

    // MARK: Stored state

    public var instanceId: String

    /// Exposes the raw mpv handle for the render context (used by MpvVideoView).
    var mpvHandle: OpaquePointer? { return mpv }

    /// Registered render views — must detach before mpv handle is destroyed.
    private var attachedViews: [MpvGLView] = []

    func registerView(_ view: MpvGLView) {
        attachedViews.append(view)
    }

    func unregisterView(_ view: MpvGLView) {
        attachedViews.removeAll { $0 === view }
    }

    private var mpv: OpaquePointer?
    private var eventThread: Thread?
    private var isShuttingDown = false

    // Listener storage — arrays of closures so callers can add more
    // than one subscriber per event. MMKV-style `remove()` returns
    // an `MpvListener` that removes by object identity (we store the
    // index alongside the closure via a wrapper class).

    private final class Subscription<Callback> {
        let callback: Callback
        init(_ callback: Callback) { self.callback = callback }
    }

    private var progressSubs: [Subscription<(Double, Double) -> Void>] = []
    private var stateSubs: [Subscription<(MpvPlaybackState) -> Void>] = []
    private var endedSubs: [Subscription<() -> Void>] = []
    private var errorSubs: [Subscription<(String) -> Void>] = []
    private var tracksSubs: [Subscription<([MpvAudioTrack], [MpvSubtitleTrack]) -> Void>] = []
    private var bufferingSubs: [Subscription<(Bool, Double) -> Void>] = []
    private var remoteSubs: [Subscription<(MpvRemoteCommand, Double) -> Void>] = []
    private var subTextSubs: [Subscription<(String) -> Void>] = []
    private var bitmapSubSubs: [Subscription<(MpvBitmapSubtitle) -> Void>] = []
    private var bitmapSubClearSubs: [Subscription<() -> Void>] = []

    // Bitmap subtitle decoder (PGS / VobSub / DVB) — parallel avformat
    // context that sits alongside mpv and pumps sub packets on a
    // background queue. See docs/native-video-pipeline.md Phase 3.
    // mpv's sub-text observer only fires for text codecs; bitmap tracks
    // go through this sidecar and render via a JS overlay layer.
    private var bitmapSubCtx: OpaquePointer?
    private let bitmapSubQueue = DispatchQueue(label: "com.jellyfuse.bitmapsub", qos: .utility)
    // Cached stream URL so seeks can restart the worker at a new
    // position. Set by `load()`; nil between sessions.
    private var currentStreamUrl: String?
    // User-Agent mpv is using for the current session. Pinned to the
    // sidecar ffmpeg open so both contexts hit the same Jellyfin session
    // (reverse proxies / transcode affinity can key on UA). Mirrors
    // whatever was passed in `MpvLoadOptions.userAgent`; nil when the
    // caller didn't override and mpv falls back to its built-in default.
    private var currentUserAgent: String?
    // avformat stream index the worker is currently decoding. `-1` when
    // no bitmap track is selected (text or off). Updated exclusively on
    // main in response to `sid` observer events so the sid handler and
    // seek/teardown agree on what track to restart.
    private var currentBitmapStreamIndex: Int32 = -1
    // Composition dimensions of the current bitmap sub stream. Captured
    // once at open time from the codec context (PGS presentation grid)
    // and attached to every emitted event so the overlay can letterbox
    // rects against the real source resolution — 1920×1080 for HD
    // Blu-ray, 3840×2160 for 4K, 720×480 for DVD — instead of a
    // hard-coded guess. `0` means the codec didn't publish a size.
    private var bitmapSubSourceWidth: Int32 = 0
    private var bitmapSubSourceHeight: Int32 = 0

    // Cached now-playing base dict. Elapsed time + rate are merged on
    // every progress/pause update so the lock-screen scrubber stays in
    // sync. `nil` means the session hasn't published metadata yet — in
    // that case we skip the MPNowPlayingInfoCenter writes entirely.
    private var nowPlayingBase: [String: Any]?
    private var remoteCommandsRegistered = false

    // Silent AVAudioPlayer "primer" — plays 1 s of silence on loop at
    // volume 0 whenever mpv is unpaused. libmpv's `ao_audiounit` uses
    // a raw RemoteIO AudioUnit which iOS doesn't recognize as a media
    // engine, so our app never qualifies for the Now Playing UI. Having
    // an AVAudioPlayer alive in the same process is enough to flip that
    // designation. Volume 0 + sampleRate 8 kHz mono keeps CPU / battery
    // overhead negligible; it only runs while the user is actively
    // watching, not 24/7.
    private var silentPrimer: AVAudioPlayer?

    // MARK: Initialization

    public required override init() {
        self.instanceId = UUID().uuidString
        super.init()
        self.mpv = createMpvHandle()
        HybridNativeMpv.instances[instanceId] = self
    }

    deinit {
        tearDownMpv()
        HybridNativeMpv.instances.removeValue(forKey: instanceId)
    }

    // MARK: Lifecycle (protocol)

    public func load(streamUrl: String, options: MpvLoadOptions) throws {
        guard let mpv = self.mpv else { throw mpvError("mpv handle is nil") }

        // `start` is a loadfile option — must be set BEFORE loadfile.
        // Other options (user-agent, speed, volume) are also pre-load.
        if let start = options.startPositionSeconds {
            try setProperty(name: "start", value: String(format: "%.3f", start))
        }
        if let rate = options.playbackRate {
            try setProperty(name: "speed", value: String(rate))
        }
        if let volume = options.volume {
            try setProperty(name: "volume", value: String(volume))
        }
        if let ua = options.userAgent {
            try setProperty(name: "user-agent", value: ua)
            currentUserAgent = ua
        } else {
            currentUserAgent = nil
        }

        // `loadfile <url>` — same invocation as the Rust backend.
        var cmd: [UnsafePointer<CChar>?] = []
        let loadfile = strdup("loadfile")
        let url = strdup(streamUrl)
        cmd.append(UnsafePointer(loadfile))
        cmd.append(UnsafePointer(url))
        cmd.append(nil)
        let rc = mpv_command(mpv, &cmd)
        free(loadfile); free(url)
        if rc < 0 {
            throw mpvError("loadfile failed: \(String(cString: mpv_error_string(rc)))")
        }

        // Remember the URL so the sid observer (+ seeks) can open the
        // sidecar PGS/VobSub/DVB decoder later. We don't auto-start
        // here: mpv's `sid` observer fires right after loadfile, tells
        // us which subtitle track is active + its ffmpeg stream index,
        // and that's the signal to open the worker. See
        // docs/native-video-pipeline.md Phase 3.
        currentStreamUrl = streamUrl

        // External subtitles BEFORE selection — each sub-add grows
        // the track list and mpv assigns the next sequential sid.
        // Order matters: callers pass these in the same order as
        // their UI list so position+1 mapping in the picker stays
        // correct (mirrors `PlayerView::new` in jf-ui-kit).
        if let externals = options.externalSubtitles {
            for sub in externals {
                var args = ["sub-add", sub.uri, "auto"]
                if let title = sub.title { args.append(title) }
                if let lang = sub.language {
                    // `sub-add` accepts optional title then language —
                    // language slot is 5th even when title is empty.
                    if args.count == 3 { args.append("") }
                    args.append(lang)
                }
                do {
                    try runCommand(args)
                } catch {
                    NSLog("[NativeMpv] sub-add failed for %@: %@", sub.uri, String(describing: error))
                }
            }
        }

        // Track selection AFTER loadfile — matching the Rust pattern.
        // mpv can't select tracks before a file is loaded.
        if let aid = options.audioTrackIndex {
            mpv_set_property_string(mpv, "aid", String(Int(aid)))
        }
        if let sid = options.subtitleTrackIndex {
            mpv_set_property_string(mpv, "sid", String(Int(sid)))
        }

        // Phase 2a harness (see docs/native-video-pipeline-phase-2.md).
        // Dev-only: spawn a parallel libavformat open on the same URL,
        // log introspection, tear down. mpv keeps rendering normally;
        // the harness is passive.
        if options.debug_enableNativeVideoHarness == true {
            startNativeVideoHarness(url: streamUrl,
                                     startSeconds: options.startPositionSeconds ?? 0,
                                     userAgent: options.userAgent)
        }
    }

    public func release() throws {
        tearDownMpv()
    }

    // MARK: Transport (protocol)

    public func play() throws {
        try setProperty(name: "pause", value: "no")
    }

    public func pause() throws {
        try setProperty(name: "pause", value: "yes")
    }

    public func seek(positionSeconds: Double) throws {
        try runCommand(["seek", String(positionSeconds), "absolute"])
        // Optimistic sync — PiP skipByInterval fires this from the
        // PiP floating window, and without an eager update the
        // scrubber briefly snaps back to the pre-seek position before
        // the playback-time observer catches up.
        currentPosition = positionSeconds
        syncViewPlaybackState()
        // Reposition the sidecar PGS/VobSub decoder too; without it the
        // worker keeps emitting captions from the pre-seek position
        // until av_read_frame naturally catches up (can be tens of
        // seconds between sparse sub packets). Skip when no bitmap
        // track is active — nothing to reposition.
        if currentBitmapStreamIndex >= 0 {
            restartBitmapSubWorker(at: positionSeconds)
        }
    }

    // MARK: Tracks / rate / volume (protocol)

    public func setAudioTrack(trackId: Double) throws {
        try setProperty(name: "aid", value: String(Int(trackId)))
    }

    public func setSubtitleTrack(trackId: Double) throws {
        try setProperty(name: "sid", value: String(Int(trackId)))
    }

    public func disableSubtitles() throws {
        try setProperty(name: "sid", value: "no")
    }

    public func setRate(rate: Double) throws {
        let clamped = max(0.25, min(3.0, rate))
        currentRate = clamped
        try setProperty(name: "speed", value: String(clamped))
        refreshNowPlaying()
    }

    public func setVolume(volume: Double) throws {
        let clamped = max(0, min(100, volume))
        try setProperty(name: "volume", value: String(clamped))
    }

    // MARK: Generic property bridge (protocol)

    public func setProperty(name: String, value: String) throws {
        guard let mpv = self.mpv else { throw mpvError("mpv handle is nil") }
        let rc = mpv_set_property_string(mpv, name, value)
        if rc < 0 {
            throw mpvError("set_property \(name): \(String(cString: mpv_error_string(rc)))")
        }
    }

    public func getProperty(name: String) throws -> String {
        guard let mpv = self.mpv else { return "" }
        guard let raw = mpv_get_property_string(mpv, name) else { return "" }
        defer { mpv_free(raw) }
        return String(cString: raw)
    }

    // MARK: Listener registration (protocol)

    public func addProgressListener(onProgress: @escaping (Double, Double) -> Void) throws -> MpvListener {
        let sub = Subscription(onProgress)
        progressSubs.append(sub)
        return makeListener { [weak self] in
            self?.progressSubs.removeAll { $0 === sub }
        }
    }

    public func addStateChangeListener(onStateChange: @escaping (MpvPlaybackState) -> Void) throws -> MpvListener {
        let sub = Subscription(onStateChange)
        stateSubs.append(sub)
        return makeListener { [weak self] in
            self?.stateSubs.removeAll { $0 === sub }
        }
    }

    public func addEndedListener(onEnded: @escaping () -> Void) throws -> MpvListener {
        let sub = Subscription(onEnded)
        endedSubs.append(sub)
        return makeListener { [weak self] in
            self?.endedSubs.removeAll { $0 === sub }
        }
    }

    public func addErrorListener(onError: @escaping (String) -> Void) throws -> MpvListener {
        let sub = Subscription(onError)
        errorSubs.append(sub)
        return makeListener { [weak self] in
            self?.errorSubs.removeAll { $0 === sub }
        }
    }

    public func addTracksListener(
        onTracksDiscovered: @escaping ([MpvAudioTrack], [MpvSubtitleTrack]) -> Void
    ) throws -> MpvListener {
        let sub = Subscription(onTracksDiscovered)
        tracksSubs.append(sub)
        return makeListener { [weak self] in
            self?.tracksSubs.removeAll { $0 === sub }
        }
    }

    public func addBufferingListener(
        onBuffering: @escaping (Bool, Double) -> Void
    ) throws -> MpvListener {
        let sub = Subscription(onBuffering)
        bufferingSubs.append(sub)
        return makeListener { [weak self] in
            self?.bufferingSubs.removeAll { $0 === sub }
        }
    }

    public func addSubtitleTextListener(
        onSubtitleText: @escaping (String) -> Void
    ) throws -> MpvListener {
        let sub = Subscription(onSubtitleText)
        subTextSubs.append(sub)
        // Fire the current value immediately so a listener attached
        // mid-caption doesn't wait until the next boundary to render.
        if !currentSubText.isEmpty {
            sub.callback(currentSubText)
        }
        return makeListener { [weak self] in
            self?.subTextSubs.removeAll { $0 === sub }
        }
    }

    public func addBitmapSubtitleListener(
        onBitmapSubtitle: @escaping (MpvBitmapSubtitle) -> Void
    ) throws -> MpvListener {
        let sub = Subscription(onBitmapSubtitle)
        bitmapSubSubs.append(sub)
        return makeListener { [weak self] in
            self?.bitmapSubSubs.removeAll { $0 === sub }
        }
    }

    public func addBitmapSubtitleClearListener(
        onClear: @escaping () -> Void
    ) throws -> MpvListener {
        let sub = Subscription(onClear)
        bitmapSubClearSubs.append(sub)
        return makeListener { [weak self] in
            self?.bitmapSubClearSubs.removeAll { $0 === sub }
        }
    }

    public func addRemoteCommandListener(
        onRemoteCommand: @escaping (MpvRemoteCommand, Double) -> Void
    ) throws -> MpvListener {
        let sub = Subscription(onRemoteCommand)
        remoteSubs.append(sub)
        registerRemoteCommandsIfNeeded()
        return makeListener { [weak self] in
            self?.remoteSubs.removeAll { $0 === sub }
        }
    }

    /// Exposed to `MpvGLView` so its PiP playback delegate can report
    /// current timing without a second property round-trip to mpv.
    var pipPosition: Double { currentPosition }
    var pipDuration: Double { currentDuration }
    var pipIsPaused: Bool { isPausedNow }
    var pipRate: Double { currentRate }

    private var lastViewSyncAt: TimeInterval = 0

    /// Push the current playback state to every attached render view so
    /// its PiP control timebase (driving scrubber + skip-forward gating)
    /// matches mpv. Safe to call from any thread — hops to main where
    /// the view touches `AVSampleBufferDisplayLayer.controlTimebase`.
    ///
    /// `throttled: true` — drop the call if another sync ran within
    /// the last ~500 ms. Use for high-frequency `playback-time`
    /// observer fires (audio-callback driven, ~100–200 Hz). The
    /// timebase has a rate set so it advances on its own between
    /// syncs; drift correction every half-second is more than enough
    /// for the PiP scrubber.
    ///
    /// `throttled: false` — always run. Use for discontinuities
    /// (pause / duration / seek) where the delegate return values
    /// actually change and iOS needs an immediate re-query.
    func syncViewPlaybackState(throttled: Bool = false) {
        if throttled {
            let now = CACurrentMediaTime()
            if now - lastViewSyncAt < 0.5 { return }
            lastViewSyncAt = now
        } else {
            lastViewSyncAt = CACurrentMediaTime()
        }
        let position = currentPosition
        let duration = currentDuration
        let isPaused = isPausedNow
        let rate = currentRate
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            for view in self.attachedViews {
                view.applyPlaybackState(
                    position: position,
                    duration: duration,
                    isPaused: isPaused,
                    rate: rate
                )
            }
        }
    }

    // MARK: Now-Playing + Remote Command Center

    public func setNowPlayingMetadata(info: Variant_NullType_MpvNowPlayingInfo?) throws {
        // Serialise all now-playing mutations on the main thread to
        // avoid races with the mpv event thread (which calls
        // `refreshNowPlaying` from property observers).
        switch info {
        case .none, .some(.first):
            DispatchQueue.main.async { [weak self] in
                self?.nowPlayingBase = nil
                MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            }
        case .some(.second(let payload)):
            let title = payload.title
            let subtitle = payload.subtitle
            let artworkUri = payload.artworkUri
            let duration = payload.durationSeconds
            let isLive = payload.isLiveStream ?? false
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                self.registerRemoteCommandsIfNeeded()
                var base: [String: Any] = [:]
                base[MPMediaItemPropertyTitle] = title
                if let subtitle = subtitle, !subtitle.isEmpty {
                    base[MPMediaItemPropertyArtist] = subtitle
                }
                if let duration = duration, duration > 0 {
                    base[MPMediaItemPropertyPlaybackDuration] = duration
                }
                base[MPNowPlayingInfoPropertyIsLiveStream] = isLive
                base[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.video.rawValue
                self.nowPlayingBase = base
                self.refreshNowPlayingOnMain()
                if let uri = artworkUri, let url = URL(string: uri) {
                    self.loadArtwork(from: url)
                }
            }
        }
    }

    private func registerRemoteCommandsIfNeeded() {
        if remoteCommandsRegistered { return }
        remoteCommandsRegistered = true

        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = true
        center.playCommand.addTarget { [weak self] _ in
            self?.fireRemoteCommand(.play, 0)
            return .success
        }
        center.pauseCommand.isEnabled = true
        center.pauseCommand.addTarget { [weak self] _ in
            self?.fireRemoteCommand(.pause, 0)
            return .success
        }
        center.togglePlayPauseCommand.isEnabled = true
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.fireRemoteCommand(.toggleplaypause, 0)
            return .success
        }

        center.skipForwardCommand.isEnabled = true
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipForwardCommand.addTarget { [weak self] _ in
            self?.fireRemoteCommand(.skipforward, 15)
            return .success
        }
        center.skipBackwardCommand.isEnabled = true
        center.skipBackwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.addTarget { [weak self] _ in
            self?.fireRemoteCommand(.skipbackward, 15)
            return .success
        }

        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self = self,
                  let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self.fireRemoteCommand(.changeplaybackposition, event.positionTime)
            return .success
        }

        // Episode nav lands later — disable so iOS doesn't render
        // no-op next/previous buttons on the lock screen.
        center.nextTrackCommand.isEnabled = false
        center.previousTrackCommand.isEnabled = false
    }

    private func fireRemoteCommand(_ cmd: MpvRemoteCommand, _ value: Double) {
        let snapshot = remoteSubs
        DispatchQueue.main.async {
            for s in snapshot { s.callback(cmd, value) }
        }
    }

    /// Called from mpv event thread — hops to main and runs the
    /// serialised refresh there.
    private func refreshNowPlaying() {
        DispatchQueue.main.async { [weak self] in
            self?.refreshNowPlayingOnMain()
        }
    }

    /// Main-thread only. Reads `nowPlayingBase` + live playback state
    /// and writes the merged dict to `MPNowPlayingInfoCenter`.
    private func refreshNowPlayingOnMain() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard var info = nowPlayingBase else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentPosition
        if currentDuration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = currentDuration
        }
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPausedNow ? 0.0 : currentRate
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        // Note: `MPNowPlayingInfoCenter.playbackState` requires the
        // private `com.apple.mediaremote.set-playback-state` entitlement
        // (Music/Podcasts only). Third-party apps communicate state via
        // `MPNowPlayingInfoPropertyPlaybackRate` in the dict above.
    }

    private func throttledRefreshNowPlaying() {
        let now = Date().timeIntervalSince1970
        if now - lastNowPlayingRefreshAt < 1.0 { return }
        lastNowPlayingRefreshAt = now
        refreshNowPlaying()
    }

    /// Applies our desired AVAudioSession configuration — `.playback`
    /// category, `.moviePlayback` mode, `.longFormVideo` route-sharing
    /// policy, no options (explicitly non-mixable). Safe to call from
    /// any thread; hops to main internally so writes are serialised.
    ///
    /// Called once at mpv-handle creation AND again whenever libmpv's
    /// `ao_audiounit` signals an audio reconfig (via the `audio-params`
    /// property observer) — without the re-apply, mpv's 3-arg
    /// `setCategory` clobbers our policy every time the AO restarts
    /// (e.g. route change, audio device change, first audio frame on a
    /// new file).
    private func applyAudioSessionConfig() {
        let work = {
            let session = AVAudioSession.sharedInstance()
            if #available(iOS 13.0, *) {
                try? session.setCategory(
                    .playback,
                    mode: .moviePlayback,
                    policy: .longFormVideo,
                    options: []
                )
            } else {
                try? session.setCategory(.playback, mode: .moviePlayback)
            }
            try? session.setActive(true)
        }
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }

    /// Builds a 1 s silent 8 kHz mono 16-bit PCM WAV and starts playing
    /// it on loop at volume 0. Must be called on main.
    private func startSilentPrimerOnMain() {
        dispatchPrecondition(condition: .onQueue(.main))
        if silentPrimer != nil { return }
        let sampleRate: UInt32 = 8000
        let channels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let numSamples: UInt32 = sampleRate
        let dataSize: UInt32 = numSamples * UInt32(bitsPerSample / 8)
        let byteRate: UInt32 = sampleRate * UInt32(bitsPerSample / 8)
        let blockAlign: UInt16 = channels * (bitsPerSample / 8)

        var wav = Data(capacity: 44 + Int(dataSize))
        func appendLE<T: FixedWidthInteger>(_ value: T) {
            var v = value.littleEndian
            withUnsafeBytes(of: &v) { wav.append(contentsOf: $0) }
        }
        wav.append(contentsOf: [0x52, 0x49, 0x46, 0x46]) // "RIFF"
        appendLE(UInt32(36 + dataSize))                   // file size - 8
        wav.append(contentsOf: [0x57, 0x41, 0x56, 0x45]) // "WAVE"
        wav.append(contentsOf: [0x66, 0x6D, 0x74, 0x20]) // "fmt "
        appendLE(UInt32(16))                              // fmt chunk size
        appendLE(UInt16(1))                               // PCM
        appendLE(channels)
        appendLE(sampleRate)
        appendLE(byteRate)
        appendLE(blockAlign)
        appendLE(bitsPerSample)
        wav.append(contentsOf: [0x64, 0x61, 0x74, 0x61]) // "data"
        appendLE(dataSize)
        wav.append(Data(count: Int(dataSize)))           // silence

        do {
            let player = try AVAudioPlayer(data: wav, fileTypeHint: AVFileType.wav.rawValue)
            player.numberOfLoops = -1
            player.volume = 0
            player.prepareToPlay()
            player.play()
            silentPrimer = player
            os_log("silent primer started", log: npLog, type: .default)
        } catch {
            NSLog("%{public}@", "[NativeMpv] silent primer failed: \(error)")
        }
    }

    private func setSilentPrimerPlaying(_ playing: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let primer = self.silentPrimer else { return }
            if playing {
                if !primer.isPlaying { primer.play() }
            } else {
                if primer.isPlaying { primer.pause() }
            }
        }
    }

    private func loadArtwork(from url: URL) {
        URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
            if let error = error {
                NSLog("%{public}@", "[NativeMpv] artwork fetch failed: \(error)")
                return
            }
            guard let self = self,
                  let data = data,
                  let image = UIImage(data: data) else {
                NSLog("%{public}@", "[NativeMpv] artwork decode failed")
                return
            }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async { [weak self] in
                guard let self = self, var info = self.nowPlayingBase else { return }
                info[MPMediaItemPropertyArtwork] = artwork
                self.nowPlayingBase = info
                self.refreshNowPlayingOnMain()
            }
        }.resume()
    }

    // MARK: - Private

    private func createMpvHandle() -> OpaquePointer? {
        guard let mpv = mpv_create() else { return nil }

        // Audio session: .playback ignores the silent switch and
        // allows background audio. `.longFormVideo` route-sharing
        // policy (iOS 13+) tells the MediaRemote daemon explicitly
        // that this session is long-form video — which is the
        // documented API for apps that don't use AVPlayer to become
        // a Now Playing candidate.
        //
        // NOTE: libmpv's ao_audiounit.m also configures AVAudioSession
        // when its audio output initializes, using the 3-arg
        // setCategory(.playback, options:) API. Without the
        // `audio-exclusive=yes` mpv option, it adds `mixWithOthers` —
        // which per WWDC22 session 110338 disqualifies us from Now
        // Playing. `audio-exclusive=yes` below makes mpv omit that
        // option. The 3-arg call also drops routeSharingPolicy back to
        // .default, so we re-apply the 4-arg config whenever mpv
        // signals an audio-params change (see `audio-params` case in
        // handlePropertyChange).
        applyAudioSessionConfig()

        // Pre-populate a placeholder now-playing dict + register
        // remote commands BEFORE audio starts. iOS decides "who is the
        // now-playing app" at the moment audio begins flowing through
        // the session — if nowPlayingInfo is empty at that instant
        // (e.g. because the JS-side title hasn't arrived yet), iOS
        // picks nobody and doesn't re-evaluate on later writes.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.startSilentPrimerOnMain()
            self.registerRemoteCommandsIfNeeded()
            if self.nowPlayingBase == nil {
                var base: [String: Any] = [:]
                base[MPMediaItemPropertyTitle] = "Jellyfuse"
                base[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.video.rawValue
                base[MPNowPlayingInfoPropertyIsLiveStream] = false
                self.nowPlayingBase = base
                self.refreshNowPlayingOnMain()
                os_log("pre-populated placeholder nowPlayingInfo", log: npLog, type: .default)
            }
        }

        // Defaults matching the Rust backend:
        // - `videotoolbox-copy` is required. Straight `videotoolbox`
        //   (zero-copy) appears to negotiate correctly in mpv's logs
        //   but the libmpv GLES renderer has two confirmed bugs:
        //     1. nv12 (8-bit) frames render with a heavy green tint
        //        (color-conversion matrix is wrong). Same bug the Rust
        //        commit 51fec4ba hit.
        //     2. p010 (10-bit HDR) frames are rejected by the VT↔GL
        //        interop — "Format unsupported. Initializing texture
        //        for hardware decoding failed" — and fall back to a
        //        blue/black screen. The GLES interop doesn't register
        //        the p010 pixel format.
        //   Both are resolved by forcing `-copy`, which makes mpv do
        //   the CPU readback + re-upload in a color-correct path.
        //   The true zero-copy win needs the Metal backend (`vo=gpu`
        //   / `gpu-next` + CAMetalLayer), not a hwdec flag change.
        // - vid=no until MpvGLView.attach() plugs in the render context;
        //   otherwise libmpv tries to open a window on its own.
        _ = mpv_set_option_string(mpv, "hwdec", "videotoolbox-copy")
        _ = mpv_set_option_string(mpv, "vo", "libmpv")
        _ = mpv_set_option_string(mpv, "vid", "no")
        // Start paused — prevents mpv from freezing when vo=libmpv
        // has no render context yet. MpvGLView.attach() unpauses
        // after creating the render context.
        _ = mpv_set_option_string(mpv, "pause", "yes")
        _ = mpv_set_option_string(mpv, "audio-device", "auto")
        // CRITICAL: prevents ao_audiounit from OR'ing
        // `AVAudioSessionCategoryOptionMixWithOthers` into our session
        // when audio output starts. A mixable session is explicitly
        // disqualified from Now Playing by iOS. See note above.
        _ = mpv_set_option_string(mpv, "audio-exclusive", "yes")
        _ = mpv_set_option_string(mpv, "cache", "yes")
        _ = mpv_set_option_string(mpv, "demuxer-max-bytes", "50MiB")
        _ = mpv_set_option_string(mpv, "demuxer-max-back-bytes", "25MiB")
        // Phase 1 of the native video pipeline migration (see
        // docs/native-video-pipeline.md): mpv still parses + tracks
        // subs (so `sub-text` keeps firing), but stops compositing
        // them into the video frame. The JS `SubtitleOverlay` is now
        // the sole sub renderer — ends the double-draw from the
        // validation window and puts us on the data path Phase 2
        // keeps after `video=no` lands.
        _ = mpv_set_option_string(mpv, "sub-visibility", "no")

        if mpv_initialize(mpv) < 0 {
            mpv_destroy(mpv)
            return nil
        }

        // Observe the properties we surface as events.
        mpv_observe_property(mpv, 1, "playback-time", MPV_FORMAT_DOUBLE)
        mpv_observe_property(mpv, 2, "duration", MPV_FORMAT_DOUBLE)
        mpv_observe_property(mpv, 3, "pause", MPV_FORMAT_FLAG)
        mpv_observe_property(mpv, 4, "eof-reached", MPV_FORMAT_FLAG)
        mpv_observe_property(mpv, 5, "track-list", MPV_FORMAT_NODE)
        mpv_observe_property(mpv, 6, "paused-for-cache", MPV_FORMAT_FLAG)
        mpv_observe_property(mpv, 7, "cache-buffering-state", MPV_FORMAT_DOUBLE)
        // audio-params fires whenever the AO is (re)configured; we
        // use it as our signal to re-apply AVAudioSession since
        // ao_audiounit has just called setCategory(.playback, options:)
        // which drops routeSharingPolicy back to .default.
        mpv_observe_property(mpv, 8, "audio-params", MPV_FORMAT_NODE)
        // Current subtitle caption (stripped of ASS tags). Fires on
        // every sub-boundary transition — no polling.
        mpv_observe_property(mpv, 9, "sub-text", MPV_FORMAT_STRING)
        // Subtitle track selection — used as the trigger to query
        // `current-tracks/sub/codec` and gate the bitmap-sub overlay
        // visibility so switching to a text track (or disabling subs)
        // hides PGS immediately.
        mpv_observe_property(mpv, 10, "sid", MPV_FORMAT_STRING)

        // Background thread pumping `mpv_wait_event`. Phase 3b may
        // merge this with the render context's update callback.
        let thread = Thread { [weak self] in self?.eventLoop() }
        thread.name = "jellyfuse.native-mpv.events"
        thread.qualityOfService = .userInitiated
        eventThread = thread
        thread.start()

        return mpv
    }

    private func tearDownMpv() {
        if isShuttingDown { return }
        isShuttingDown = true
        stopBitmapSubWorker()
        HybridNativeMpv.instances.removeValue(forKey: instanceId)
        // Detach all render views BEFORE destroying the mpv handle.
        // mpv docs: "mpv_render_context_free() should be called before
        // the mpv core is destroyed."
        let views = attachedViews
        attachedViews.removeAll()
        for view in views { view.detach() }
        progressSubs.removeAll()
        stateSubs.removeAll()
        endedSubs.removeAll()
        errorSubs.removeAll()
        tracksSubs.removeAll()
        bufferingSubs.removeAll()
        remoteSubs.removeAll()
        subTextSubs.removeAll()
        bitmapSubSubs.removeAll()
        bitmapSubClearSubs.removeAll()
        currentStreamUrl = nil
        currentUserAgent = nil
        currentBitmapStreamIndex = -1
        nowPlayingBase = nil
        DispatchQueue.main.async { [weak self] in
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            self?.silentPrimer?.stop()
            self?.silentPrimer = nil
        }
        if remoteCommandsRegistered {
            let center = MPRemoteCommandCenter.shared()
            center.playCommand.removeTarget(nil)
            center.pauseCommand.removeTarget(nil)
            center.togglePlayPauseCommand.removeTarget(nil)
            center.skipForwardCommand.removeTarget(nil)
            center.skipBackwardCommand.removeTarget(nil)
            center.changePlaybackPositionCommand.removeTarget(nil)
            center.nextTrackCommand.removeTarget(nil)
            center.previousTrackCommand.removeTarget(nil)
            remoteCommandsRegistered = false
        }
        if let mpv = self.mpv {
            mpv_terminate_destroy(mpv)
            self.mpv = nil
        }
        // The event thread polls a weak self, so it exits on the
        // next iteration when `self.mpv == nil`.
    }

    private func eventLoop() {
        while !isShuttingDown, let mpv = self.mpv {
            guard let eventPtr = mpv_wait_event(mpv, -1) else { continue }
            let event = eventPtr.pointee
            switch event.event_id {
            case MPV_EVENT_SHUTDOWN:
                return
            case MPV_EVENT_END_FILE:
                fireEnded()
                fireState(.ended)
            case MPV_EVENT_PROPERTY_CHANGE:
                handlePropertyChange(event)
            default:
                break
            }
        }
    }

    // Cached values so we can fire progress with both pos + dur
    private var currentPosition: Double = 0
    private var currentDuration: Double = 0
    private var currentRate: Double = 1.0
    private var isPausedNow: Bool = true
    // Throttle MPNowPlayingInfoCenter writes to ~1 Hz — libmpv fires
    // `playback-time` observers much more frequently than the lock
    // screen UI needs.
    private var lastNowPlayingRefreshAt: TimeInterval = 0
    // Throttle JS progress emission to ~10 Hz. libmpv's `playback-time`
    // observer is driven by the audio callback at 100–200 Hz; relaying
    // every tick to JS across the Nitro bridge was the #1 CPU hotspot
    // (Time Profiler showed ~23% on the RN JS thread for Hermes +
    // React re-renders during playback).
    private var lastProgressEmitAt: TimeInterval = 0
    // Last caption we emitted — deduped before firing listeners so
    // repeated identical property events (mpv re-emits on track /
    // seek) don't spam the JS bridge.
    private var currentSubText: String = ""

    private func handlePropertyChange(_ event: mpv_event) {
        guard let dataPtr = event.data else { return }
        let prop = dataPtr.assumingMemoryBound(to: mpv_event_property.self).pointee
        guard let namePtr = prop.name else { return }
        let name = String(cString: namePtr)

        switch name {
        case "playback-time":
            guard prop.format == MPV_FORMAT_DOUBLE, let valPtr = prop.data else { return }
            currentPosition = valPtr.assumingMemoryBound(to: Double.self).pointee
            let now = CACurrentMediaTime()
            if now - lastProgressEmitAt >= 0.1 {
                lastProgressEmitAt = now
                let snap = progressSubs
                for s in snap { s.callback(currentPosition, currentDuration) }
            }
            throttledRefreshNowPlaying()
            syncViewPlaybackState(throttled: true)

        case "duration":
            guard prop.format == MPV_FORMAT_DOUBLE, let valPtr = prop.data else { return }
            currentDuration = valPtr.assumingMemoryBound(to: Double.self).pointee
            refreshNowPlaying()
            syncViewPlaybackState()

        case "pause":
            guard prop.format == MPV_FORMAT_FLAG, let valPtr = prop.data else { return }
            let paused = valPtr.assumingMemoryBound(to: Int32.self).pointee != 0
            isPausedNow = paused
            let state: MpvPlaybackState = paused ? .paused : .playing
            fireState(state)
            setSilentPrimerPlaying(!paused)
            refreshNowPlaying()
            syncViewPlaybackState()

        case "eof-reached":
            guard prop.format == MPV_FORMAT_FLAG, let valPtr = prop.data else { return }
            let eof = valPtr.assumingMemoryBound(to: Int32.self).pointee != 0
            if eof { fireEnded(); fireState(.ended) }

        case "paused-for-cache":
            guard prop.format == MPV_FORMAT_FLAG, let valPtr = prop.data else { return }
            let buffering = valPtr.assumingMemoryBound(to: Int32.self).pointee != 0
            let snap = bufferingSubs
            for s in snap { s.callback(buffering, 0) }

        case "cache-buffering-state":
            guard prop.format == MPV_FORMAT_DOUBLE, let valPtr = prop.data else { return }
            let progress = valPtr.assumingMemoryBound(to: Double.self).pointee / 100.0
            let snap = bufferingSubs
            for s in snap { s.callback(progress < 1.0, progress) }

        case "audio-params":
            // ao_audiounit just (re)configured AVAudioSession with its
            // own 3-arg setCategory, blowing away our .longFormVideo
            // policy. Re-apply ours so the Now Playing / MediaRemote
            // pipeline sees us as a long-form-video candidate.
            applyAudioSessionConfig()
            os_log("re-applied AVAudioSession after audio-params change",
                   log: npLog, type: .default)

        case "sub-text":
            // prop.data holds a `char **` — dereference twice. Format
            // is MPV_FORMAT_STRING; mpv owns the buffer for the
            // duration of this event.
            let text: String
            if prop.format == MPV_FORMAT_STRING, let valPtr = prop.data {
                let strPtrPtr = valPtr.assumingMemoryBound(to: UnsafePointer<CChar>?.self)
                if let strPtr = strPtrPtr.pointee {
                    text = String(cString: strPtr)
                } else {
                    text = ""
                }
            } else {
                text = ""
            }
            if text != currentSubText {
                currentSubText = text
                let snap = subTextSubs
                for s in snap { s.callback(text) }
            }

        case "sid":
            // Active subtitle track changed (or disabled via `sid=no`).
            // Query codec + avformat stream index lazily — they reflect
            // the new selection at the moment of this observer fire.
            let sidValue = (try? getProperty(name: "sid")) ?? ""
            let codec = (try? getProperty(name: "current-tracks/sub/codec")) ?? ""
            let ffIndexStr = (try? getProperty(name: "current-tracks/sub/ff-index")) ?? ""
            let ffIndex = Int32(ffIndexStr) ?? -1
            os_log("sid changed: sid=%{public}@ codec=%{public}@ ff-index=%d",
                   log: npLog, type: .info, sidValue, codec, Int(ffIndex))
            handleSubTrackChange(codec: codec, ffIndex: ffIndex)

        default:
            break
        }
    }

    /// React to a subtitle track selection change. For bitmap codecs
    /// (PGS / VobSub / DVB) we stop any previous worker and open a
    /// fresh one on the new avformat stream so captions match the
    /// language the user just picked. For text tracks (or `sid=no`)
    /// we tear the worker down and emit a clear so the overlay hides
    /// instantly — text rendering flows through mpv's `sub-text`
    /// property, handled separately by `SubtitleOverlay`.
    ///
    /// Called from the mpv event thread; state mutations hop to main
    /// so `currentBitmapStreamIndex` has a single writer.
    private func handleSubTrackChange(codec: String, ffIndex: Int32) {
        let isBitmap: Bool
        switch codec {
        case "hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle":
            isBitmap = true
        default:
            isBitmap = false
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if isBitmap && ffIndex >= 0 {
                if ffIndex == self.currentBitmapStreamIndex { return }
                self.currentBitmapStreamIndex = ffIndex
                guard let url = self.currentStreamUrl else { return }
                // Hide any still-visible caption from the previous
                // track before the new worker's first event lands.
                for s in self.bitmapSubClearSubs { s.callback() }
                self.startBitmapSubWorker(
                    url: url,
                    startSeconds: self.currentPosition,
                    streamIndex: ffIndex,
                    userAgent: self.currentUserAgent
                )
            } else {
                if self.currentBitmapStreamIndex < 0 { return }
                self.currentBitmapStreamIndex = -1
                self.stopBitmapSubWorker()
                for s in self.bitmapSubClearSubs { s.callback() }
            }
        }
    }

    // MARK: Firing listeners

    private func fireEnded() {
        let snapshot = endedSubs
        for s in snapshot { s.callback() }
    }

    private func fireState(_ state: MpvPlaybackState) {
        let snapshot = stateSubs
        for s in snapshot { s.callback(state) }
    }

    // MARK: Helpers

    private func runCommand(_ args: [String]) throws {
        guard let mpv = self.mpv else { throw mpvError("mpv handle is nil") }
        let cArgs = args.map { strdup($0) }
        defer { cArgs.forEach { free($0) } }
        var buf: [UnsafePointer<CChar>?] = cArgs.map { UnsafePointer($0) }
        buf.append(nil)
        let rc = mpv_command(mpv, &buf)
        if rc < 0 {
            throw mpvError("command \(args.first ?? "?"): \(String(cString: mpv_error_string(rc)))")
        }
    }

    private func mpvError(_ message: String) -> RuntimeError {
        RuntimeError(message)
    }

    private func makeListener(_ remove: @escaping () -> Void) -> MpvListener {
        // The generated MpvListener struct has a single `remove`
        // closure field — nitrogen produces the backing type from
        // the TS interface declaration in NativeMpv.nitro.ts.
        return MpvListener(remove: remove)
    }

    // MARK: Bitmap subtitle worker

    // RGBA (bytes = R,G,B,A) → PNG → base64 data URI. Returns nil on
    // allocation / encoder failure. The RGBA layout matches what
    // FFmpegBridge.mm produces; byte order 32Big + premultiplied-last
    // feeds it straight to CoreGraphics without a channel swap.
    private static func encodeRgbaAsPngDataUri(
        _ rgba: UnsafePointer<UInt8>,
        width: Int,
        height: Int,
    ) -> String? {
        let bytesPerRow = width * 4
        let byteCount = bytesPerRow * height
        guard let provider = CGDataProvider(
            dataInfo: nil,
            data: rgba,
            size: byteCount,
            releaseData: { _, _, _ in },
        ) else {
            return nil
        }
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        // The PGS / VobSub palette ships straight (non-premultiplied)
        // RGBA. Using `.last` preserves the anti-aliased edges — with
        // `.premultipliedLast` CoreGraphics assumes the RGB was already
        // multiplied by A and un-multiplies, halving the brightness of
        // edge pixels.
        let bitmapInfo: CGBitmapInfo = [
            .byteOrder32Big,
            CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
        ]
        guard let cgImage = CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: bitmapInfo,
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent,
        ) else {
            return nil
        }
        let uiImage = UIImage(cgImage: cgImage)
        guard let png = uiImage.pngData() else { return nil }
        return "data:image/png;base64,\(png.base64EncodedString())"
    }

    // ─── Phase 2a harness (docs/native-video-pipeline-phase-2.md) ────
    // Opens a parallel libavformat context on the stream URL, logs the
    // video codec / dimensions / bit depth / color tags / HDR metadata,
    // and tears down. Strictly passive — mpv keeps rendering. Runs on
    // a one-shot background queue so the blocking HTTP open doesn't
    // block load(). Intentionally standalone from the bitmap-sub
    // worker: the two sidecars use independent streams and neither
    // should stall on the other.
    private func startNativeVideoHarness(url: String,
                                          startSeconds: Double,
                                          userAgent: String?) {
        NSLog("[VideoHarness] invoked — url-len=%d start=%.2f ua=%@",
              url.count, startSeconds, userAgent ?? "(none)")
        DispatchQueue.global(qos: .utility).async {
            NSLog("[VideoHarness] worker started, calling jf_video_open")
            let ctx: OpaquePointer? = url.withCString { urlPtr in
                if let ua = userAgent {
                    return ua.withCString { uaPtr in
                        jf_video_open(urlPtr, startSeconds, uaPtr)
                    }
                }
                return jf_video_open(urlPtr, startSeconds, nil)
            }
            guard let ctx else {
                NSLog("[VideoHarness] open FAILED")
                return
            }
            defer { jf_video_close(ctx) }

            let codecId = jf_video_codec_id(ctx)
            let bits = jf_video_bits_per_sample(ctx)
            var w: Int32 = 0; var h: Int32 = 0
            jf_video_dimensions(ctx, &w, &h)
            var pri: Int32 = 0; var trc: Int32 = 0; var mat: Int32 = 0; var rng: Int32 = 0
            jf_video_color_info(ctx, &pri, &trc, &mat, &rng)
            var mastering = [UInt32](repeating: 0, count: 10)
            let hasMastering = mastering.withUnsafeMutableBufferPointer { buf in
                jf_video_hdr_mastering(ctx, buf.baseAddress!)
            }
            var cll = [UInt16](repeating: 0, count: 2)
            let hasCll = cll.withUnsafeMutableBufferPointer { buf in
                jf_video_hdr_cll(ctx, buf.baseAddress!)
            }
            let dv = jf_video_dolby_vision_profile(ctx)

            let pixelFmt = jf_video_pixel_format(ctx)
            let pfChars = String(format: "%c%c%c%c",
                                 Int((pixelFmt >> 24) & 0xff),
                                 Int((pixelFmt >> 16) & 0xff),
                                 Int((pixelFmt >> 8) & 0xff),
                                 Int(pixelFmt & 0xff))
            NSLog("""
                [VideoHarness] open OK codec=%d %dx%d bits=%d pf=%@ \
                color pri=%d trc=%d mat=%d range=%d \
                mastering=%d cll=%d (max=%d fall=%d) dv=%d
                """,
                  codecId, w, h, bits, pfChars,
                  pri, trc, mat, rng,
                  hasMastering, hasCll, Int(cll[0]), Int(cll[1]),
                  dv)
        }
    }

    private func startBitmapSubWorker(
        url: String,
        startSeconds: Double,
        streamIndex: Int32,
        userAgent: String?,
    ) {
        stopBitmapSubWorker()
        bitmapSubQueue.async { [weak self] in
            guard let self else { return }
            let ctx: OpaquePointer? = url.withCString { urlPtr in
                if let ua = userAgent {
                    return ua.withCString { uaPtr in
                        jf_bitmap_sub_open(urlPtr, startSeconds, streamIndex, uaPtr)
                    }
                }
                return jf_bitmap_sub_open(urlPtr, startSeconds, streamIndex, nil)
            }
            guard let ctx else { return }
            // Publish the handle so `stopBitmapSubWorker` can signal
            // cancel from another thread. The worker itself owns the
            // close — the stopper only flips the cancel flag and
            // clears the published ref.
            self.bitmapSubCtx = ctx
            var srcW: Int32 = 0
            var srcH: Int32 = 0
            jf_bitmap_sub_source_size(ctx, &srcW, &srcH)
            self.bitmapSubSourceWidth = srcW
            self.bitmapSubSourceHeight = srcH
            self.runBitmapSubLoop(ctx: ctx)
            self.bitmapSubCtx = nil
            jf_bitmap_sub_close(ctx)
        }
    }

    private func stopBitmapSubWorker() {
        // Signal cancel; the worker unblocks from av_read_frame via the
        // interrupt_callback, the loop exits (cancel-aware), and the
        // worker's own close path frees the ctx. We do NOT close here —
        // that would race with a decode_next still in flight.
        if let ctx = bitmapSubCtx {
            jf_bitmap_sub_cancel(ctx)
        }
    }

    /// Tear the current worker down and start a fresh one positioned at
    /// `seconds`. The serial `bitmapSubQueue` guarantees the old worker
    /// finishes its close path before the new `open` runs. We also fire
    /// a clear event synchronously so the overlay hides immediately
    /// during the seek transition — otherwise the stale caption from
    /// before the seek would linger until the new worker emitted its
    /// first event.
    private func restartBitmapSubWorker(at seconds: Double) {
        guard let url = currentStreamUrl, currentBitmapStreamIndex >= 0 else { return }
        let snap = bitmapSubClearSubs
        DispatchQueue.main.async {
            for s in snap { s.callback() }
        }
        startBitmapSubWorker(
            url: url,
            startSeconds: max(0, seconds),
            streamIndex: currentBitmapStreamIndex,
            userAgent: currentUserAgent
        )
    }

    private func runBitmapSubLoop(ctx: OpaquePointer) {
        var pts: Double = 0
        var dur: Double = 0
        var numRects: Int32 = 0
        var x: Int32 = 0, y: Int32 = 0, w: Int32 = 0, h: Int32 = 0
        var rgba: UnsafeMutablePointer<UInt8>? = nil

        while !isShuttingDown {
            let rc = jf_bitmap_sub_decode_next(ctx, &pts, &dur, &numRects, &x, &y, &w, &h, &rgba)
            if rc == 1 {
                os_log("bitmap-sub: EOF", log: npLog, type: .info)
                break
            }
            if rc < 0 {
                // Cancel is reported back through decode_next (av_read_frame
                // returns EIO via the interrupt_callback). Treat it as a
                // normal exit — the stopper set the flag on purpose.
                break
            }

            // Pace the emission against mpv's playback time. The ffmpeg
            // demuxer reads as fast as I/O allows, so without this the
            // worker races ahead of the video and captions fire minutes
            // early. While mpv is paused, `currentPosition` freezes and
            // the sleep loop idles — which also stops the overlay from
            // advancing through captions during a pause.
            while !isShuttingDown
                && jf_bitmap_sub_is_cancelled(ctx) == 0
                && self.currentPosition < pts - 0.2
            {
                Thread.sleep(forTimeInterval: 0.1)
            }
            if jf_bitmap_sub_is_cancelled(ctx) != 0 {
                if let rgbaPtr = rgba { jf_bitmap_sub_free_rgba(rgbaPtr); rgba = nil }
                break
            }
            // Skip events that belong entirely to the past — after a
            // forward seek, the decoder may still emit a few events from
            // before the seek before av_read_frame reads from the new
            // position. Drop them so they don't flash on screen.
            if dur > 0 && self.currentPosition > pts + dur + 0.5 {
                if let rgbaPtr = rgba { jf_bitmap_sub_free_rgba(rgbaPtr); rgba = nil }
                continue
            }

            if numRects == 0 {
                DispatchQueue.main.async { [weak self] in
                    guard let self else { return }
                    for s in self.bitmapSubClearSubs { s.callback() }
                }
            } else if let rgbaPtr = rgba, w > 0, h > 0 {
                // Encode RGBA → PNG → base64 → data URI so the JS overlay
                // can feed it straight into <Image>. PGS rects are tiny
                // (few hundred bytes compressed) and fire every 2–3 s,
                // so the per-event cost is negligible vs pulling in a
                // pixel-pushing lib.
                let dataUri = Self.encodeRgbaAsPngDataUri(rgbaPtr, width: Int(w), height: Int(h))
                jf_bitmap_sub_free_rgba(rgbaPtr)
                rgba = nil

                if let dataUri {
                    let event = MpvBitmapSubtitle(
                        ptsSeconds: pts,
                        durationSeconds: dur,
                        x: Double(x),
                        y: Double(y),
                        width: Double(w),
                        height: Double(h),
                        sourceWidth: Double(self.bitmapSubSourceWidth),
                        sourceHeight: Double(self.bitmapSubSourceHeight),
                        imageUri: dataUri,
                    )
                    DispatchQueue.main.async { [weak self] in
                        guard let self else { return }
                        for s in self.bitmapSubSubs { s.callback(event) }
                    }
                }
            } else if let rgbaPtr = rgba {
                jf_bitmap_sub_free_rgba(rgbaPtr)
                rgba = nil
            }
        }
    }
}
