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

import Foundation
import NitroModules

// MPVKit exports the libmpv C headers under the `Libmpv` umbrella.
// The module map lives at vendor/ios/mpvkit-*/include — the
// podspec's HEADER_SEARCH_PATHS wires it up.
import Libmpv

// MARK: - HybridNativeMpv

/// `NativeMpv` hybrid object — one instance per player session.
///
/// The generated `HybridNativeMpvSpec` protocol is produced by
/// `nitrogen` from `src/NativeMpv.nitro.ts`. Run
/// `bun run nitrogen` in this package to regenerate it after spec
/// edits; the regenerated files land under
/// `modules/native-mpv/nitrogen/generated/ios`.
public final class HybridNativeMpv: HybridNativeMpvSpec {
    // MARK: Stored state

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

    // MARK: Initialization

    public required init() {
        super.init()
        self.mpv = createMpvHandle()
    }

    deinit {
        tearDownMpv()
    }

    // MARK: Lifecycle (protocol)

    public func load(streamUrl: String, options: MpvLoadOptions) throws {
        guard let mpv = self.mpv else { throw mpvError("mpv handle is nil") }

        // Apply start-up options *before* we fire loadfile so the
        // first frame/packet lands at the right position.
        if let start = options.startPositionSeconds {
            try setProperty("start", String(start))
        }
        if let aid = options.audioTrackIndex {
            try setProperty("aid", String(aid))
        }
        if let sid = options.subtitleTrackIndex {
            try setProperty("sid", String(sid))
        }
        if let rate = options.playbackRate {
            try setProperty("speed", String(rate))
        }
        if let volume = options.volume {
            try setProperty("volume", String(volume))
        }
        if let ua = options.userAgent {
            try setProperty("user-agent", ua)
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
    }

    public func release() throws {
        tearDownMpv()
    }

    // MARK: Transport (protocol)

    public func play() throws {
        try setProperty("pause", "no")
    }

    public func pause() throws {
        try setProperty("pause", "yes")
    }

    public func seek(positionSeconds: Double) throws {
        try runCommand(["seek", String(positionSeconds), "absolute"])
    }

    // MARK: Tracks / rate / volume (protocol)

    public func setAudioTrack(trackId: Double) throws {
        try setProperty("aid", String(Int(trackId)))
    }

    public func setSubtitleTrack(trackId: Double) throws {
        try setProperty("sid", String(Int(trackId)))
    }

    public func disableSubtitles() throws {
        try setProperty("sid", "no")
    }

    public func setRate(rate: Double) throws {
        let clamped = max(0.25, min(3.0, rate))
        try setProperty("speed", String(clamped))
    }

    public func setVolume(volume: Double) throws {
        let clamped = max(0, min(100, volume))
        try setProperty("volume", String(clamped))
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

    // MARK: - Private

    private func createMpvHandle() -> OpaquePointer? {
        guard let mpv = mpv_create() else { return nil }

        // Defaults matching the Rust backend:
        // - videotoolbox-copy hwdec fixed the color correctness issue
        //   (see commit 51fec4ba in the Rust repo).
        // - vid=no until phase 3b plugs in a render context; otherwise
        //   libmpv will try to open a window on its own.
        _ = mpv_set_option_string(mpv, "hwdec", "videotoolbox-copy")
        _ = mpv_set_option_string(mpv, "vid", "no")
        _ = mpv_set_option_string(mpv, "audio-device", "auto")
        _ = mpv_set_option_string(mpv, "cache", "yes")
        _ = mpv_set_option_string(mpv, "demuxer-max-bytes", "50MiB")
        _ = mpv_set_option_string(mpv, "demuxer-max-back-bytes", "25MiB")

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
        progressSubs.removeAll()
        stateSubs.removeAll()
        endedSubs.removeAll()
        errorSubs.removeAll()
        tracksSubs.removeAll()
        bufferingSubs.removeAll()
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

    private func handlePropertyChange(_ event: mpv_event) {
        // TODO(phase-3a): decode the property payload, update
        // `currentPosition` / `currentDuration` in local state, and
        // fire the relevant subscribers on the JS thread. This will
        // fill in gradually as we test against real MPV property
        // streams — the audio-only validation target is progress +
        // state change + ended firing correctly.
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
        var cArgs = args.map { strdup($0) }
        defer { cArgs.forEach { free($0) } }
        var buf: [UnsafePointer<CChar>?] = cArgs.map { UnsafePointer($0) }
        buf.append(nil)
        let rc = mpv_command(mpv, &buf)
        if rc < 0 {
            throw mpvError("command \(args.first ?? "?"): \(String(cString: mpv_error_string(rc)))")
        }
    }

    private func mpvError(_ message: String) -> NSError {
        NSError(
            domain: "jellyfuse.native-mpv",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }

    private func makeListener(_ remove: @escaping () -> Void) -> MpvListener {
        // The generated MpvListener struct has a single `remove`
        // closure field — nitrogen produces the backing type from
        // the TS interface declaration in NativeMpv.nitro.ts.
        return MpvListener(remove: remove)
    }
}
