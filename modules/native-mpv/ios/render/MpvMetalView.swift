//
//  MpvMetalView.swift
//  @jellyfuse/native-mpv — Phase 1 render rewrite
//
//  UIView whose root layer is `AVSampleBufferDisplayLayer`. Owns the
//  per-session Metal/Vulkan render stack:
//
//      MTLDevice
//          │
//      ─── IOSurface ring (N=3 BGRA buffers, host-allocated)
//          │           │
//          │           ▼
//          │       VkImage  ── target of mpv_render_context_render
//          │           │
//          │           └─► CVPixelBuffer (zero-copy)
//          │                    │
//          │                    ▼
//          │            CMSampleBuffer (PTS off CMTimebase)
//          │                    │
//          ▼                    ▼
//      AVSampleBufferDisplayLayer  ◄── consumed on-screen + by PiP
//
//  The CADisplayLink only flips a `pendingRender` flag. The dedicated
//  render queue (`com.jellyfuse.mpv.render`) is the only place
//  `mpv_render_context_render` runs, which makes the queue itself the
//  serializer — the `os_unfair_lock` from the GLES path is gone.
//
//  PiP plumbing (CMTimebase + AVPictureInPictureController) lives on
//  `HybridMpvVideoView`'s wrapper, identical to the GLES era; we only
//  surface the AVSBDL layer + a `applyPlaybackState` hook.
//

import AVFoundation
import AVKit
import CoreMedia
import CoreVideo
import Foundation
import IOSurface
import Libmpv
import Metal
import QuartzCore
import UIKit

// MARK: - Ring entry

/// One slot in the IOSurface render ring. The IOSurface is the storage
/// shared between the Vulkan render target (libmpv writes here) and
/// the CMSampleBuffer queue (AVSBDL reads from here).
private struct RingEntry {
    let ioSurface: IOSurfaceRef
    let pixelBuffer: CVPixelBuffer
    let vkImage: VkImage
    let width: Int
    let height: Int
}

// MARK: - MpvMetalView

final class MpvMetalView: UIView {

    // ── Root layer ───────────────────────────────────────────────────
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }

    var sampleBufferLayer: AVSampleBufferDisplayLayer {
        return layer as! AVSampleBufferDisplayLayer
    }

    // ── Metal ────────────────────────────────────────────────────────
    private let metalDevice: MTLDevice

    // ── Vulkan + render context ──────────────────────────────────────
    private var vulkanBridge: MpvVulkanBridge?
    private var renderContext: MpvRenderContext?
    private var enqueuer: MpvSampleBufferEnqueuer?
    private weak var attachedPlayer: HybridNativeMpv?
    private var mpvHandle: OpaquePointer?

    // ── IOSurface ring ───────────────────────────────────────────────
    private static let ringSize: Int = 3
    private var ring: [RingEntry] = []
    private var nextRingIndex: Int = 0
    private var ringWidth: Int = 0
    private var ringHeight: Int = 0

    // ── Render scheduling ────────────────────────────────────────────
    /// Serial queue — the only thread that calls
    /// `mpv_render_context_render`. CADisplayLink lives on main.
    private let renderQueue = DispatchQueue(
        label: "com.jellyfuse.mpv.render", qos: .userInteractive
    )
    private var displayLink: CADisplayLink?
    /// Atomically set by the mpv update callback (off-thread) and the
    /// CADisplayLink (main); read by the render queue. `Int` so we can
    /// use `OSAtomicCompareAndSwap32Barrier` semantics via `_Atomic`.
    private var pendingRenderFlag: Int32 = 0

    // ── Lifecycle observers ─────────────────────────────────────────
    private var isAppInBackground: Bool = false

    // ── PiP scrubber timebase ───────────────────────────────────────
    /// Drives the PiP scrubber + skip-forward gating. Owned here
    /// because it is bound to `sampleBufferLayer.controlTimebase`,
    /// but mutated from the wrapper (`HybridMpvVideoView`).
    private var controlTimebase: CMTimebase?
    private var lastInvalidatedDuration: Double = -1
    private var lastInvalidatedPaused: Bool = true
    private var lastInvalidatedRate: Double = -1

    // ── PiP controller ──────────────────────────────────────────────
    private var pipController: AVPictureInPictureController?
    private var isPipActive: Bool = false

    // MARK: Init

    override init(frame: CGRect) {
        guard let dev = MTLCreateSystemDefaultDevice() else {
            fatalError("[MpvMetalView] No MTLDevice — Metal is not available on this OS")
        }
        self.metalDevice = dev
        super.init(frame: frame)
        configureView()
        registerLifecycleObservers()
    }

    required init?(coder: NSCoder) {
        guard let dev = MTLCreateSystemDefaultDevice() else { return nil }
        self.metalDevice = dev
        super.init(coder: coder)
        configureView()
        registerLifecycleObservers()
    }

    private func configureView() {
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
        if !shouldKeepRenderingInBackground() {
            displayLink?.isPaused = true
        }
    }

    @objc private func handleWillEnterForeground() {
        isAppInBackground = false
        displayLink?.isPaused = false
        markNeedsRender()
    }

    private func shouldKeepRenderingInBackground() -> Bool {
        guard let controller = pipController else { return false }
        if controller.isPictureInPictureActive { return true }
        if #available(iOS 14.2, *) {
            return controller.canStartPictureInPictureAutomaticallyFromInline
        }
        return false
    }

    // MARK: Attach / detach

    func attach(player: HybridNativeMpv, mpvHandle handle: OpaquePointer) {
        guard renderContext == nil else { return }
        mpvHandle = handle
        attachedPlayer = player
        player.registerView(self)

        do {
            // 1. Vulkan bring-up.
            let bridge = try MpvVulkanBridge(metalDevice: metalDevice)
            self.vulkanBridge = bridge

            // 2. mpv render context — Vulkan API type.
            let ctx = try MpvRenderContext(mpv: handle, bridge: bridge) { [weak self] in
                self?.markNeedsRender()
            }
            self.renderContext = ctx

            // 3. Sample-buffer enqueuer.
            self.enqueuer = MpvSampleBufferEnqueuer(layer: sampleBufferLayer)

            // 4. Display link + control timebase + PiP.
            startDisplayLink()
            setupControlTimebase()
            setupPipController()
        } catch {
            NSLog("[MpvMetalView] attach failed: %@", String(describing: error))
            tearDown()
        }
    }

    func detach() {
        tearDown()
    }

    // MARK: Render scheduling

    /// Called from mpv's update-callback thread AND from the main
    /// thread (foreground transitions). Serialised against the
    /// CADisplayLink + render queue via `OSAtomicCompareAndSwap32`.
    func markNeedsRender() {
        OSAtomicCompareAndSwap32Barrier(0, 1, &pendingRenderFlag)
    }

    private func startDisplayLink() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(displayLinkTick))
        if UIScreen.main.maximumFramesPerSecond >= 120 {
            link.preferredFramesPerSecond = 120
        }
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func displayLinkTick() {
        // Only schedule a render if mpv has signalled "frame ready"
        // since the last tick. Skips ~96 of 120 ticks for 24fps video.
        guard OSAtomicCompareAndSwap32Barrier(1, 0, &pendingRenderFlag) else { return }
        renderQueue.async { [weak self] in
            self?.renderOneFrame()
        }
    }

    /// Runs on `renderQueue`. The only place that calls
    /// `mpv_render_context_render`.
    private func renderOneFrame() {
        guard let renderContext = renderContext, let mpv = mpvHandle else { return }

        let updateFlags = mpv_render_context_update(renderContext.handle)
        guard updateFlags & UInt64(MPV_RENDER_UPDATE_FRAME.rawValue) != 0 else { return }

        // Resize the IOSurface ring on the first frame and on any
        // adaptive-bitrate / aspect change.
        guard let (w, h) = readMpvVideoSize(mpv: mpv) else { return }
        if w != ringWidth || h != ringHeight {
            do {
                try ensureRing(width: w, height: h)
            } catch {
                NSLog("[MpvMetalView] ensureRing(%d,%d) failed: %@", w, h, String(describing: error))
                return
            }
        }
        guard !ring.isEmpty else { return }

        let entry = ring[nextRingIndex]
        nextRingIndex = (nextRingIndex + 1) % ring.count

        // mpv renders into the IOSurface-backed VkImage. Block until
        // the GPU finishes (libmpv_vk's done_frame calls
        // pl_gpu_finish), so the IOSurface contents are valid when
        // the enqueuer wraps them as a CMSampleBuffer.
        do {
            try renderContext.render(
                targetImage: entry.vkImage,
                width: UInt32(entry.width),
                height: UInt32(entry.height),
                format: VK_FORMAT_B8G8R8A8_UNORM
            )
        } catch {
            NSLog("[MpvMetalView] render failed: %@", String(describing: error))
            return
        }

        // Hop to main to enqueue + mutate the AVSBDL state
        // (`enqueue` is documented thread-safe but the layer's
        // `flush` / `requiresFlushToResumeDecoding` reads are not).
        let pixelBuffer = entry.pixelBuffer
        let enqueuer = self.enqueuer
        DispatchQueue.main.async {
            enqueuer?.enqueue(pixelBuffer: pixelBuffer)
        }
    }

    // MARK: Ring management

    private func ensureRing(width: Int, height: Int) throws {
        guard width > 0, height > 0 else { return }
        guard let bridge = vulkanBridge else { return }

        // Tear down the old ring.
        for entry in ring { bridge.destroyImage(entry.vkImage) }
        ring.removeAll(keepingCapacity: true)

        // Block the AVSBDL from reading stale frames at the old size.
        sampleBufferLayer.flushAndRemoveImage()

        for _ in 0..<MpvMetalView.ringSize {
            let entry = try makeRingEntry(width: width, height: height, bridge: bridge)
            ring.append(entry)
        }
        ringWidth = width
        ringHeight = height
        nextRingIndex = 0
    }

    private func makeRingEntry(
        width: Int, height: Int, bridge: MpvVulkanBridge
    ) throws -> RingEntry {
        // 32BGRA — matches VK_FORMAT_B8G8R8A8_UNORM. Phase 3 will
        // switch to 10-bit P010 for HDR streams; the IOSurface format
        // is detected from the first decoded frame at that point.
        let bytesPerRow = width * 4
        let attrs: [String: Any] = [
            kIOSurfaceWidth as String: width,
            kIOSurfaceHeight as String: height,
            kIOSurfaceBytesPerElement as String: 4,
            kIOSurfaceBytesPerRow as String: bytesPerRow,
            kIOSurfacePixelFormat as String: Int(kCVPixelFormatType_32BGRA),
        ]
        guard let surface = IOSurfaceCreate(attrs as CFDictionary) else {
            throw MpvVulkanBridgeError.vk(VK_ERROR_OUT_OF_HOST_MEMORY, "IOSurfaceCreate")
        }

        var unmanagedPB: Unmanaged<CVPixelBuffer>?
        let pbAttrs: [String: Any] = [
            kCVPixelBufferIOSurfacePropertiesKey as String: [:]
        ]
        let rc = CVPixelBufferCreateWithIOSurface(
            kCFAllocatorDefault, surface, pbAttrs as CFDictionary, &unmanagedPB
        )
        guard rc == kCVReturnSuccess, let pb = unmanagedPB?.takeRetainedValue() else {
            throw MpvVulkanBridgeError.vk(VK_ERROR_OUT_OF_HOST_MEMORY, "CVPixelBufferCreateWithIOSurface")
        }

        // Tag SDR BT.709 by default. Phase 3 overrides per-frame.
        CVBufferSetAttachment(
            pb, kCVImageBufferColorPrimariesKey,
            kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate
        )
        CVBufferSetAttachment(
            pb, kCVImageBufferTransferFunctionKey,
            kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate
        )
        CVBufferSetAttachment(
            pb, kCVImageBufferYCbCrMatrixKey,
            kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate
        )

        let image = try bridge.makeImageFromIOSurface(
            surface,
            width: UInt32(width),
            height: UInt32(height),
            format: VK_FORMAT_B8G8R8A8_UNORM
        )

        return RingEntry(
            ioSurface: surface,
            pixelBuffer: pb,
            vkImage: image,
            width: width,
            height: height
        )
    }

    private func readMpvVideoSize(mpv: OpaquePointer) -> (Int, Int)? {
        var w: Int64 = 0
        var h: Int64 = 0
        guard mpv_get_property(mpv, "dwidth", MPV_FORMAT_INT64, &w) >= 0 else { return nil }
        guard mpv_get_property(mpv, "dheight", MPV_FORMAT_INT64, &h) >= 0 else { return nil }
        guard w > 0, h > 0 else { return nil }
        return (Int(w), Int(h))
    }

    // MARK: PiP / control timebase

    private func setupControlTimebase() {
        var timebase: CMTimebase?
        let rc = CMTimebaseCreateWithSourceClock(
            allocator: kCFAllocatorDefault,
            sourceClock: CMClockGetHostTimeClock(),
            timebaseOut: &timebase
        )
        guard rc == noErr, let tb = timebase else {
            NSLog("[MpvMetalView] CMTimebaseCreateWithSourceClock failed: %d", rc)
            return
        }
        CMTimebaseSetTime(tb, time: .zero)
        CMTimebaseSetRate(tb, rate: 0)
        sampleBufferLayer.controlTimebase = tb
        controlTimebase = tb
    }

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
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        pipController = controller
    }

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
        let stateChanged = isPaused != lastInvalidatedPaused
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

    // MARK: Tear-down

    private func tearDown() {
        let work = { [self] in
            displayLink?.invalidate()
            displayLink = nil

            pipController = nil

            if let tb = controlTimebase {
                CMTimebaseSetRate(tb, rate: 0)
            }
            sampleBufferLayer.controlTimebase = nil
            controlTimebase = nil
            lastInvalidatedDuration = -1
            lastInvalidatedPaused = true
            lastInvalidatedRate = -1

            // Render context owns the libplacebo Vulkan import — must
            // tear down before the bridge.
            renderContext = nil
            enqueuer = nil

            if let bridge = vulkanBridge {
                for entry in ring { bridge.destroyImage(entry.vkImage) }
            }
            ring.removeAll(keepingCapacity: false)
            ringWidth = 0
            ringHeight = 0
            nextRingIndex = 0

            vulkanBridge = nil

            attachedPlayer?.unregisterView(self)
            attachedPlayer = nil
            mpvHandle = nil

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

// MARK: - PiP delegates (matches the GLES era — only the layer changed)

@available(iOS 15.0, *)
extension MpvMetalView: AVPictureInPictureControllerDelegate {
    func pictureInPictureControllerDidStartPictureInPicture(
        _ controller: AVPictureInPictureController
    ) {
        isPipActive = true
    }

    func pictureInPictureControllerDidStopPictureInPicture(
        _ controller: AVPictureInPictureController
    ) {
        isPipActive = false
        if isAppInBackground {
            displayLink?.isPaused = true
        }
    }

    func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: Error
    ) {
        NSLog("[MpvMetalView] PiP failed to start: %@", String(describing: error))
    }

    func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void
    ) {
        completionHandler(true)
    }
}

@available(iOS 15.0, *)
extension MpvMetalView: AVPictureInPictureSampleBufferPlaybackDelegate {
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
            NSLog("[MpvMetalView] PiP setPlaying error: %@", String(describing: error))
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
        // No-op. Ring tracks decode size; iOS downsamples for PiP.
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
            NSLog("[MpvMetalView] PiP skipByInterval error: %@", String(describing: error))
        }
    }
}
