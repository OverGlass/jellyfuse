//
//  HybridMpvVideoView.swift
//  @jellyfuse/native-mpv — iOS video render surface
//
//  Surface vs. source split:
//
//     ┌──────────────────────── MpvVideoView ─────────────────────────┐
//     │   AVSampleBufferDisplayLayer  ◄── PiP controller (AVKit)      │
//     │   CMTimebase (PiP scrubber)                                   │
//     │   Background / foreground lifecycle                           │
//     │                                                               │
//     │                       VideoSource ?                           │
//     │                          │                                    │
//     │                          ▼ enqueue(CMSampleBuffer)            │
//     │   ┌──── MpvRenderContextSource ─ or ─ NativeVideoToolboxSource ┐
//     │   │  Frame production:                                         │
//     │   │    - legacy: mpv_render_context + GLES + BGRA pool         │
//     │   │    - native: libavformat + VideoToolbox (Phase 2c)         │
//     │   └─────────────────────────────────────────────────────────── ┘
//     └────────────────────────────────────────────────────────────────┘
//
//  The host view (`MpvVideoView`) stays identical across backends so
//  PiP, the control timebase, and app-lifecycle handling don't have to
//  know which source is producing frames. Swap-in of the native decoder
//  in Phase 2c just replaces the `VideoSource` instance.
//

import AVFoundation
import AVKit
import CoreMedia
import CoreVideo
import Foundation
import NitroModules
import QuartzCore

// MARK: - VideoSource

/// A pluggable frame producer. Attach-time the source is handed the
/// target layer + the owning player; from then on it's free to enqueue
/// sample buffers on its own schedule (display link, decode thread,
/// whatever). The host view only calls `detach()` on teardown and
/// forwards app-lifecycle transitions.
protocol VideoSource: AnyObject {
    /// Begin producing frames into `layer`. Called once on main.
    ///
    /// - `player`: the owning `HybridNativeMpv` — sources that still
    ///   need mpv (legacy render path, or the native decoder reading
    ///   `audio-pts`) keep a weak reference.
    /// - `handle`: raw `mpv_handle *` for the same player, exposed
    ///   because some libmpv calls (`mpv_render_context_*`,
    ///   `mpv_set_property_string`) take the handle directly.
    func attach(
        to layer: AVSampleBufferDisplayLayer,
        player: HybridNativeMpv,
        mpvHandle handle: OpaquePointer
    )

    /// Stop producing frames and release all resources. Idempotent.
    func detach()

    /// Called whenever the owning app transitions between foreground
    /// and background. `pipKeepingLayerLive` is `true` when PiP is
    /// active or armed to auto-start — in that case the source should
    /// keep producing frames even while backgrounded (iOS pulls them
    /// for the floating window).
    func applicationBackgroundDidChange(isBackground: Bool, pipKeepingLayerLive: Bool)
}

// MARK: - MpvVideoView

/// UIView whose root layer is an `AVSampleBufferDisplayLayer`. Owns the
/// PiP controller, the control timebase driving the PiP scrubber, and
/// application lifecycle observation. Frame production is delegated
/// to a `VideoSource` (the GL-based legacy path, or the VideoToolbox
/// path in Phase 2c).
final class MpvVideoView: UIView {

    // ── Root layer ──────────────────────────────────────────────────────
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }

    private var sampleBufferLayer: AVSampleBufferDisplayLayer {
        return layer as! AVSampleBufferDisplayLayer
    }

    // ── Source + player ────────────────────────────────────────────────
    private var source: VideoSource?
    private weak var attachedPlayer: HybridNativeMpv?

    // ── Picture-in-Picture ──────────────────────────────────────────────
    private var pipController: AVPictureInPictureController?
    private var isAppInBackground: Bool = false
    private var isPipActive: Bool = false

    // ── PiP scrubber timebase ───────────────────────────────────────────
    // iOS reads this to determine "current playback time" for the PiP
    // scrubber and to gate the skip-forward / skip-backward buttons.
    // Without it, iOS falls back to the sample buffers' PTS — which we
    // stamp with host-clock time — and concludes the playhead is
    // ~boot-uptime seconds into the movie, disabling skip-forward.
    private var controlTimebase: CMTimebase?
    // Only reissue `invalidatePlaybackState()` when values the delegate
    // actually returns change. Position updates every video frame but
    // the timebase handles advancement on its own.
    private var lastInvalidatedDuration: Double = -1
    private var lastInvalidatedPaused: Bool = true
    private var lastInvalidatedRate: Double = -1

    // MARK: Init

    override init(frame: CGRect) {
        super.init(frame: frame)
        configureView()
        registerLifecycleObservers()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configureView()
        registerLifecycleObservers()
    }

    private func configureView() {
        // `.resizeAspect` letterboxes the video inside the view —
        // matches the behaviour mpv's internal letterboxing gave us
        // with the old CAEAGLLayer path.
        sampleBufferLayer.videoGravity = .resizeAspect
        backgroundColor = .black
        isOpaque = true
        contentScaleFactor = UIScreen.main.scale
    }

    private func registerLifecycleObservers() {
        let nc = NotificationCenter.default
        nc.addObserver(
            self,
            selector: #selector(handleDidEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
        nc.addObserver(
            self,
            selector: #selector(handleWillEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
    }

    @objc private func handleDidEnterBackground() {
        isAppInBackground = true
        source?.applicationBackgroundDidChange(
            isBackground: true,
            pipKeepingLayerLive: shouldKeepRenderingInBackground()
        )
    }

    @objc private func handleWillEnterForeground() {
        isAppInBackground = false
        source?.applicationBackgroundDidChange(
            isBackground: false,
            pipKeepingLayerLive: false
        )
    }

    /// True when we expect iOS to pull frames from the sample-buffer
    /// layer in the background — either PiP is already active, or
    /// it's armed to auto-start on backgrounding.
    private func shouldKeepRenderingInBackground() -> Bool {
        guard let controller = pipController else { return false }
        if controller.isPictureInPictureActive { return true }
        if #available(iOS 14.2, *) {
            return controller.canStartPictureInPictureAutomaticallyFromInline
        }
        return false
    }

    // MARK: Attach / Detach

    /// Connect to an mpv player instance and start rendering video via
    /// the given source.
    func attach(
        source: VideoSource,
        player: HybridNativeMpv,
        mpvHandle handle: OpaquePointer
    ) {
        guard self.source == nil else { return }
        self.source = source
        attachedPlayer = player
        player.registerView(self)

        // Control timebase — must be set on the layer BEFORE the PiP
        // controller is created, otherwise the controller caches the
        // "no timebase" state and skip buttons stay disabled for the
        // life of the PiP session.
        setupControlTimebase()

        // PiP controller — iOS 15+ custom-source. The controller
        // observes our sample-buffer layer, so the same frames the
        // source enqueues on-screen are the frames iOS shows in the
        // floating window.
        setupPipController()

        // Hand the layer + player to the source. From here on it
        // drives its own render loop.
        source.attach(to: sampleBufferLayer, player: player, mpvHandle: handle)
    }

    /// Disconnect from the player. Tears down source + PiP + timebase.
    func detach() {
        tearDown()
    }

    // MARK: - PiP controller

    private func setupPipController() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard AVPictureInPictureController.isPictureInPictureSupported() else { return }
        guard #available(iOS 15.0, *) else { return }
        guard pipController == nil else { return }

        let contentSource = AVPictureInPictureController.ContentSource(
            sampleBufferDisplayLayer: sampleBufferLayer,
            playbackDelegate: self
        )
        let controller = AVPictureInPictureController(contentSource: contentSource)
        controller.delegate = self
        // YouTube-style: iOS auto-enters PiP on `willResignActive`.
        // Requires `picture-in-picture` in `UIBackgroundModes`.
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        pipController = controller
    }

    private func tearDownPipController() {
        pipController = nil
    }

    // MARK: - Control timebase

    private func setupControlTimebase() {
        var timebase: CMTimebase?
        let rc = CMTimebaseCreateWithSourceClock(
            allocator: kCFAllocatorDefault,
            sourceClock: CMClockGetHostTimeClock(),
            timebaseOut: &timebase
        )
        guard rc == noErr, let tb = timebase else {
            NSLog("[MpvVideoView] CMTimebaseCreateWithSourceClock failed: %d", rc)
            return
        }
        CMTimebaseSetTime(tb, time: .zero)
        CMTimebaseSetRate(tb, rate: 0)
        sampleBufferLayer.controlTimebase = tb
        controlTimebase = tb
    }

    /// Sync the PiP scrubber and skip-gate with mpv's current playback
    /// state. Called from `HybridNativeMpv`'s property observers on
    /// pause / duration / playback-time ticks — and eagerly after
    /// seek(), so the scrubber doesn't briefly jerk back before the
    /// next observer fires. Must run on main.
    func applyPlaybackState(
        position: Double, duration: Double, isPaused: Bool, rate: Double
    ) {
        dispatchPrecondition(condition: .onQueue(.main))
        if let tb = controlTimebase {
            CMTimebaseSetTime(
                tb, time: CMTime(seconds: position, preferredTimescale: 600)
            )
            CMTimebaseSetRate(tb, rate: isPaused ? 0 : rate)
        }
        let stateChanged =
            isPaused != lastInvalidatedPaused
            || duration != lastInvalidatedDuration
            || rate != lastInvalidatedRate
        guard stateChanged else { return }
        lastInvalidatedPaused = isPaused
        lastInvalidatedDuration = duration
        lastInvalidatedRate = rate
        if #available(iOS 15.0, *) {
            pipController?.invalidatePlaybackState()
        }
    }

    // MARK: - Teardown

    private func tearDown() {
        let work = { [self] in
            tearDownPipController()

            if let tb = controlTimebase {
                CMTimebaseSetRate(tb, rate: 0)
            }
            sampleBufferLayer.controlTimebase = nil
            controlTimebase = nil
            lastInvalidatedDuration = -1
            lastInvalidatedPaused = true
            lastInvalidatedRate = -1

            source?.detach()
            source = nil

            attachedPlayer?.unregisterView(self)
            attachedPlayer = nil

            sampleBufferLayer.flushAndRemoveImage()
        }

        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.sync { work() }
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        tearDown()
    }
}

// MARK: - AVPictureInPictureControllerDelegate

@available(iOS 15.0, *)
extension MpvVideoView: AVPictureInPictureControllerDelegate {
    func pictureInPictureControllerDidStartPictureInPicture(
        _ controller: AVPictureInPictureController
    ) {
        isPipActive = true
    }

    func pictureInPictureControllerDidStopPictureInPicture(
        _ controller: AVPictureInPictureController
    ) {
        isPipActive = false
        // If the user dismisses PiP while the app is still in the
        // background, nothing is reading our frames anymore — let the
        // source pause its render loop.
        if isAppInBackground {
            source?.applicationBackgroundDidChange(
                isBackground: true,
                pipKeepingLayerLive: false
            )
        }
    }

    func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: Error
    ) {
        NSLog("[MpvVideoView] PiP failed to start: %@", String(describing: error))
    }

    func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        // Option 2 auto-PiP keeps the player screen mounted behind the
        // floating window, so the UI is already "restored" by the time
        // iOS asks. Ack immediately — otherwise iOS finishes its
        // zoom-in animation before we respond, then re-lays out the
        // layer, causing a visible zoom-dezoom snap.
        completionHandler(true)
    }
}

// MARK: - AVPictureInPictureSampleBufferPlaybackDelegate

@available(iOS 15.0, *)
extension MpvVideoView: AVPictureInPictureSampleBufferPlaybackDelegate {
    func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        setPlaying playing: Bool
    ) {
        guard let player = attachedPlayer else { return }
        do {
            if playing {
                try player.play()
            } else {
                try player.pause()
            }
        } catch {
            NSLog("[MpvVideoView] PiP setPlaying error: %@", String(describing: error))
        }
    }

    func pictureInPictureControllerTimeRangeForPlayback(
        _ controller: AVPictureInPictureController
    ) -> CMTimeRange {
        guard let player = attachedPlayer else {
            return CMTimeRange(start: .zero, duration: .zero)
        }
        let duration = player.pipDuration
        if duration <= 0 || !duration.isFinite {
            // Indefinite / live — Apple's docs use (-inf, +inf) and
            // the PiP overlay hides the scrubber.
            return CMTimeRange(
                start: CMTime(seconds: -.infinity, preferredTimescale: 1),
                duration: CMTime(seconds: .infinity, preferredTimescale: 1)
            )
        }
        return CMTimeRange(
            start: .zero,
            duration: CMTime(seconds: duration, preferredTimescale: 600)
        )
    }

    func pictureInPictureControllerIsPlaybackPaused(
        _ controller: AVPictureInPictureController
    ) -> Bool {
        return attachedPlayer?.pipIsPaused ?? true
    }

    func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        didTransitionToRenderSize newRenderSize: CMVideoDimensions
    ) {
        // No-op. The source tracks decode size; iOS downsamples for
        // the PiP window.
    }

    func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        skipByInterval skipInterval: CMTime,
        completion completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        guard let player = attachedPlayer else { return }
        let delta = CMTimeGetSeconds(skipInterval)
        let target = max(0, player.pipPosition + delta)
        do {
            try player.seek(positionSeconds: target)
        } catch {
            NSLog("[MpvVideoView] PiP skipByInterval error: %@", String(describing: error))
        }
    }
}

// MARK: - HybridMpvVideoView (Nitro HybridView wrapper)

/// Nitro HybridView wrapping `MpvVideoView`. React mounts this as
/// `<MpvVideoView>` and calls `attachPlayer` / `detachPlayer` via the
/// `hybridRef`. The concrete `VideoSource` is selected here — Phase 2b
/// ships the legacy `MpvRenderContextSource` unconditionally; Phase 2c
/// adds a `source` option that picks the native decoder.
public final class HybridMpvVideoView: HybridMpvVideoViewSpec {

    private let videoView = MpvVideoView()

    public var view: UIView { return videoView }

    public required override init() {
        super.init()
    }

    public func attachPlayer(instanceId: String, options: MpvAttachOptions?) throws {
        guard let player = HybridNativeMpv.instance(for: instanceId) else {
            throw RuntimeError("No player with instanceId \(instanceId)")
        }
        guard let handle = player.mpvHandle else {
            throw RuntimeError("Player has been released")
        }
        let selected = options?.source ?? .mpv
        if selected == .native {
            // Phase 2c — NativeVideoToolboxSource lands in Commit C3.
            // Until then, fall back to the legacy render path so the
            // option can be plumbed through JS without breaking
            // playback.
            NSLog(
                "[MpvVideoView] source=native requested but decoder not implemented yet — falling back to mpv render"
            )
        }
        // Nitro calls hybridRef from the JS thread, but the source's
        // GL setup and `AVPictureInPictureController` construction
        // must run on main.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let source: VideoSource = MpvRenderContextSource()
            self.videoView.attach(source: source, player: player, mpvHandle: handle)
        }
    }

    public func detachPlayer() throws {
        videoView.detach()
    }

    public func onDropView() {
        videoView.detach()
    }
}
