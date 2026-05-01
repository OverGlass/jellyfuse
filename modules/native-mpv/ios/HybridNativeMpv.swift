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
    private var attachedViews: [MpvMetalView] = []

    func registerView(_ view: MpvMetalView) {
        attachedViews.append(view)
    }

    func unregisterView(_ view: MpvMetalView) {
        attachedViews.removeAll { $0 === view }
    }

    /// Called by `MpvMetalView.attach` once the headless VkImage pool is
    /// registered with mpv. Flips `vid` from `no` (initial) to `auto`,
    /// which is what triggers mpv to create its vo and start reading
    /// from our pool. Without this gate, vo_create can fire on the very
    /// first `loadfile` — before the React view has mounted and
    /// registered its pool — and fail with "no headless image pool
    /// registered".
    func activateVideoOutput() {
        guard let mpv = self.mpv else { return }
        _ = mpv_set_property_string(mpv, "vid", "auto")
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

    // Cached now-playing base dict. Elapsed time + rate are merged on
    // every progress/pause update so the lock-screen scrubber stays in
    // sync. `nil` means the session hasn't published metadata yet — in
    // that case we skip the MPNowPlayingInfoCenter writes entirely.
    private var nowPlayingBase: [String: Any]?
    private var remoteCommandsRegistered = false

    // (Phase 2: removed `silentPrimer`. ao_avfoundation publishes real
    // audio through AVSampleBufferAudioRenderer, which iOS recognises as
    // a media engine — we no longer need a parallel AVAudioPlayer to
    // qualify for Now Playing. The fork build is what unlocks this:
    // MPVKit 0.41.0 didn't compile audio_out_avfoundation, so the
    // consumer was stuck on ao_audiounit + workaround. See
    // `project_ao_avfoundation_already_upstream.md`.)

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

    /// Configures our desired AVAudioSession at mpv-handle creation:
    /// `.playback` category, `.moviePlayback` mode, `.longFormVideo`
    /// route-sharing policy, no `mixWithOthers`. Called exactly once;
    /// `ao_avfoundation` (Phase 2) does not clobber the configuration
    /// the way `ao_audiounit` did, so we no longer need the
    /// `audio-params` re-apply observer.
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
        // that this session is long-form video — the documented API
        // for apps that don't use AVPlayer to become a Now Playing
        // candidate.
        //
        // Phase 2 simplification: ao_avfoundation (selected via
        // --ao=avfoundation,audiounit below) routes audio through
        // AVSampleBufferAudioRenderer + AVSampleBufferRenderSynchronizer,
        // which respects the session we configured here and does not
        // clobber routeSharingPolicy on AO restart. The audio-params
        // re-apply observer + audio-exclusive=yes + AVAudioPlayer
        // silent primer that we used with ao_audiounit are all gone.
        applyAudioSessionConfig()

        // Pre-populate a placeholder now-playing dict + register
        // remote commands BEFORE audio starts. iOS decides "who is the
        // now-playing app" at the moment audio begins flowing through
        // the session — if nowPlayingInfo is empty at that instant
        // (e.g. because the JS-side title hasn't arrived yet), iOS
        // picks nobody and doesn't re-evaluate on later writes.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
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

        // Phase 1B render path: vo=gpu-next + libplacebo's pl_renderer
        // running over MoltenVK, writing into IOSurface-backed VkImages
        // we own. The fork-side ra_ctx (`gpu-context=libmpvvk`) imports
        // our VkInstance/VkDevice — see `MpvMetalView.attach` →
        // `mpv_libmpv_apple_set_pool`. hwdec=videotoolbox is true
        // zero-copy now that the Vulkan path imports VideoToolbox's
        // CVPixelBuffer-backed IOSurfaces directly via
        // VK_EXT_metal_objects. Lifecycle: mpv_create → set options →
        // mpv_initialize → idle until MpvMetalView.attach() registers
        // the pool → JS calls load(streamUrl). Until attach lands, mpv
        // has nothing to do.
        _ = mpv_set_option_string(mpv, "vo", "gpu-next")
        _ = mpv_set_option_string(mpv, "gpu-api", "vulkan")
        _ = mpv_set_option_string(mpv, "gpu-context", "libmpvvk")
        // Hardware decode via VideoToolbox, zero-copy to libplacebo via
        // PL_HANDLE_IOSURFACE. Requires the patched MoltenVK 1.4.1
        // (apple/patches/MoltenVK/0001-iosurface-plane-heuristic.patch)
        // which selects the matching IOSurface plane by dimensions —
        // upstream `VkImportMetalIOSurfaceInfoEXT` has no plane field.
        _ = mpv_set_option_string(mpv, "hwdec", "videotoolbox")

        // Phase 3 — HDR10 + HLG. Static libplacebo options applied
        // unconditionally; SDR streams ignore them. With these set,
        // HDR10/HLG sources are tone-mapped via libplacebo's BT.2390
        // soft-knee curve into our current SDR BGRA output IOSurfaces.
        // Steps 2-4 (video-params observer, AVSBDL EDR metadata, P010
        // ring rebuild) follow.
        //
        //  - target-trc=auto / target-prim=auto: let libplacebo pick the
        //    output transfer/primaries from the active swapchain. Our
        //    pool is BT.709 SDR today; HDR rebuild flips this.
        //  - tone-mapping=bt.2390: the standardised soft-knee tone-map.
        //    Closest to "neutral" of the available curves; safe default.
        //  - hdr-compute-peak=yes: dynamic peak detection per scene
        //    (compute-shader-driven). Better than static peak metadata
        //    for content with inaccurate MaxCLL.
        //  - gamut-mapping-mode=perceptual: BT.2020 → BT.709 gamut
        //    compression that preserves saturation relations rather
        //    than hard-clipping.
        _ = mpv_set_option_string(mpv, "target-trc", "auto")
        _ = mpv_set_option_string(mpv, "target-prim", "auto")
        _ = mpv_set_option_string(mpv, "tone-mapping", "bt.2390")
        _ = mpv_set_option_string(mpv, "hdr-compute-peak", "yes")
        _ = mpv_set_option_string(mpv, "gamut-mapping-mode", "perceptual")

        // Phase 1B lifecycle gate: with `vid=no` mpv parses tracks during
        // loadfile but doesn't initialise the video output. The view's
        // `attach()` flips this back to `auto` once the consumer-side
        // pool is registered with libmpvvk — only then does mpv create
        // its vo and read our pool. Without this gate, JS code that
        // calls `load()` before the React view mounts would trigger
        // vo_create with an empty pool ("no headless image pool
        // registered" → vo init fails → no video).
        _ = mpv_set_option_string(mpv, "vid", "no")
        _ = mpv_set_option_string(mpv, "audio-device", "auto")
        // Phase 2: ao_avfoundation first (AVSampleBufferAudioRenderer +
        // AVSampleBufferRenderSynchronizer — respects the
        // .longFormVideo session configured above). audiounit kept as a
        // bitstream-passthrough fallback: ao_avfoundation rejects SPDIF
        // (per upstream `af_fmt_is_spdif` check), and mpv falls through
        // to the next AO in the list for those sessions.
        _ = mpv_set_option_string(mpv, "ao", "avfoundation,audiounit")
        _ = mpv_set_option_string(mpv, "cache", "yes")
        _ = mpv_set_option_string(mpv, "demuxer-max-bytes", "50MiB")
        _ = mpv_set_option_string(mpv, "demuxer-max-back-bytes", "25MiB")

        if mpv_initialize(mpv) < 0 {
            mpv_destroy(mpv)
            return nil
        }

        // Surface mpv core + libplacebo logs through MPV_EVENT_LOG_MESSAGE so
        // failures inside `mpv_render_context_create` (e.g. libplacebo's
        // "Missing device feature: ...") aren't swallowed silently.
        _ = mpv_request_log_messages(mpv, "v")

        // Observe the properties we surface as events.
        mpv_observe_property(mpv, 1, "playback-time", MPV_FORMAT_DOUBLE)
        mpv_observe_property(mpv, 2, "duration", MPV_FORMAT_DOUBLE)
        mpv_observe_property(mpv, 3, "pause", MPV_FORMAT_FLAG)
        mpv_observe_property(mpv, 4, "eof-reached", MPV_FORMAT_FLAG)
        mpv_observe_property(mpv, 5, "track-list", MPV_FORMAT_NODE)
        mpv_observe_property(mpv, 6, "paused-for-cache", MPV_FORMAT_FLAG)
        mpv_observe_property(mpv, 7, "cache-buffering-state", MPV_FORMAT_DOUBLE)
        // Phase 3 step 2: detect HDR mode from the source. video-params is a
        // node-map; we read `gamma` (transfer) and `primaries` to classify the
        // source as SDR / HDR10 / HLG. Step 3 uses this to flip
        // wantsExtendedDynamicRangeContent + EDRMetadata on AVSBDL.
        mpv_observe_property(mpv, 8, "video-params", MPV_FORMAT_NODE)
        // (Phase 2 removed the audio-params observer — ao_avfoundation
        // doesn't clobber routeSharingPolicy on restart, so the
        // re-apply trick that ao_audiounit needed is gone.)

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
        nowPlayingBase = nil
        DispatchQueue.main.async {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
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
            case MPV_EVENT_LOG_MESSAGE:
                if let raw = event.data?.assumingMemoryBound(to: mpv_event_log_message.self) {
                    let prefix = raw.pointee.prefix.map { String(cString: $0) } ?? "?"
                    let text = raw.pointee.text.map { String(cString: $0) } ?? ""
                    NSLog("[mpv:%@] %@", prefix, text.trimmingCharacters(in: .whitespacesAndNewlines))
                }
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

        case "video-params":
            guard prop.format == MPV_FORMAT_NODE, let valPtr = prop.data else { return }
            let node = valPtr.assumingMemoryBound(to: mpv_node.self).pointee
            let fields = readMpvNodeMapStrings(node, keys: ["gamma", "primaries"])
            let mode = MpvHdrMode.classify(
                transfer: fields["gamma"], primaries: fields["primaries"]
            )
            applyHdrMode(mode)

        default:
            break
        }
    }

    /// Cached so we only forward when the classification actually changes —
    /// `video-params` fires on every reconfig and most events are no-ops for
    /// HDR mode (e.g. resolution changes, deinterlacer toggles).
    private var currentHdrMode: MpvHdrMode = .sdr

    private func applyHdrMode(_ mode: MpvHdrMode) {
        guard mode != currentHdrMode else { return }
        currentHdrMode = mode
        NSLog("[HybridNativeMpv] hdr mode → %@", String(describing: mode))
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            for view in self.attachedViews { view.applyHdrMode(mode) }
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
}
