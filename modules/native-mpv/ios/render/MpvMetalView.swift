//
//  MpvMetalView.swift
//  @jellyfuse/native-mpv — Phase 1B (Path B)
//
//  UIView whose root layer is `AVSampleBufferDisplayLayer`. Owns the
//  per-session IOSurface ring + the bridge into mpv's headless Vulkan
//  ra_ctx. The render pipeline mpv side is `vo=gpu-next` driving
//  `pl_renderer` straight into our IOSurface-backed VkImages — see
//  `docs/phase-1b-path-b-plan.md`.
//
//  We DO NOT call mpv_render_context_create. Instead we register a
//  VkImage pool via the fork-extension API
//  `mpv_libmpv_apple_set_pool(...)` (defined in
//  `mpv/render_libmpv_apple.h`). mpv's render thread calls our
//  `acquire` / `present` callbacks once per frame:
//
//      acquire(out_index) → returns next ring slot to render into
//      present(index, sem_wait) → mpv finished writing slot `index`,
//                                   wait on sem_wait before reading it
//
//  Frame layout:
//
//      MTLDevice
//          │
//      ─── IOSurface ring (N=3 BGRA, host-allocated)
//          │           │
//          │           ▼
//          │       VkImage      ← libplacebo writes here
//          │           │
//          │           ▼
//          │       CVPixelBuffer (zero-copy, same IOSurface)
//          │                │
//          │                ▼
//          │        CMSampleBuffer (PTS off CMTimebase)
//          │                ▼
//          ▼      AVSampleBufferDisplayLayer ← consumed on-screen + by PiP
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

private struct RingEntry {
    let ioSurface: IOSurfaceRef
    let pixelBuffer: CVPixelBuffer
    let vkImage: VkImage
}

final class MpvMetalView: UIView {

    // ── Root layer ───────────────────────────────────────────────────
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
    var sampleBufferLayer: AVSampleBufferDisplayLayer {
        return layer as! AVSampleBufferDisplayLayer
    }

    // ── Metal device (kept around so we can hand IOSurfaces to a
    //    Metal copy/blit if we need to in a future phase). ──────────
    private let metalDevice: MTLDevice

    // ── Per-session render plumbing ──────────────────────────────────
    private var vulkanBridge: MpvVulkanBridge?
    private var ring: [RingEntry] = []
    private var ringWidth: Int = 0
    private var ringHeight: Int = 0
    private weak var attachedPlayer: HybridNativeMpv?
    /// Raw mpv handle. Not weak — `OpaquePointer` is a struct. Must be
    /// nilled in `tearDown` so we don't dereference a freed mpv core.
    private var attachedMpv: OpaquePointer?
    private var enqueuer: MpvSampleBufferEnqueuer?

    // ── Pool delivery to mpv ─────────────────────────────────────────
    /// Storage for the VkImage handle array we hand mpv. Must outlive
    /// the corresponding pool registration; mpv keeps the pointer.
    private var poolImages: [VkImage?] = []
    /// Storage for the device-extension name array (NULL-terminated by
    /// libplacebo's pl_vulkan_import; we just need stable storage).
    private var deviceExtCStrings: [UnsafeMutablePointer<CChar>?] = []
    private var deviceExtPtrs: [UnsafePointer<CChar>?] = []
    /// Retained Unmanaged pointer to `self`, handed to mpv as
    /// `pool.priv` so the C callbacks can find us. Released in
    /// `tearDown`.
    private var poolSelfRetainer: Unmanaged<MpvMetalView>?

    // ── Round-robin acquire ──────────────────────────────────────────
    /// Atomic counter. `acquire` increments, mods by ringSize. With a
    /// ring of 3 and `swapchain_depth = 2`, the swapchain holds at
    /// most two images at a time and AVSBDL always has the third —
    /// no extra free-list bookkeeping needed.
    private var nextRingIndex: Int32 = 0

    // ── PiP scrubber timebase ───────────────────────────────────────
    private var controlTimebase: CMTimebase?
    private var lastInvalidatedDuration: Double = -1
    private var lastInvalidatedPaused: Bool = true
    private var lastInvalidatedRate: Double = -1

    // ── PiP controller ──────────────────────────────────────────────
    private var pipController: AVPictureInPictureController?
    private var isPipActive: Bool = false
    private var isAppInBackground: Bool = false

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
        nc.addObserver(self, selector: #selector(handleDidEnterBackground),
                       name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(handleWillEnterForeground),
                       name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func handleDidEnterBackground() { isAppInBackground = true }
    @objc private func handleWillEnterForeground() { isAppInBackground = false }

    // MARK: Attach / detach

    func attach(player: HybridNativeMpv, mpvHandle handle: OpaquePointer) {
        guard vulkanBridge == nil else { return }

        // Pool dimensions: pick a sensible fixed target. The fixed pool
        // size is a Phase 1B v1 limitation — pl_swapchain_resize is a
        // no-op for the headless impl, so a true resize means
        // tear-down + rebuild. 1080p is the right default for embedded
        // playback on iOS / iPadOS / Apple TV; HDR / 4K modes will
        // grow it on demand in a follow-up phase.
        let w = 1920
        let h = 1080

        do {
            let bridge = try MpvVulkanBridge(metalDevice: metalDevice)
            self.vulkanBridge = bridge

            try buildRing(width: w, height: h, bridge: bridge)
            try registerPool(width: w, height: h, mpv: handle, bridge: bridge)
        } catch {
            NSLog("[MpvMetalView] attach failed: %@", String(describing: error))
            tearDown()
            return
        }

        attachedPlayer = player
        attachedMpv = handle
        player.registerView(self)

        enqueuer = MpvSampleBufferEnqueuer(layer: sampleBufferLayer)

        DispatchQueue.main.async { [weak self] in
            self?.setupControlTimebase()
            self?.setupPipController()
        }
    }

    func detach() {
        tearDown()
    }

    // MARK: Ring build + pool registration

    private func buildRing(width: Int, height: Int, bridge: MpvVulkanBridge) throws {
        let bytesPerRow = width * 4
        let attrs: [String: Any] = [
            kIOSurfaceWidth as String: width,
            kIOSurfaceHeight as String: height,
            kIOSurfaceBytesPerElement as String: 4,
            kIOSurfaceBytesPerRow as String: bytesPerRow,
            kIOSurfacePixelFormat as String: Int(kCVPixelFormatType_32BGRA),
        ]
        ring.removeAll()
        for _ in 0..<MpvMetalView.poolSize {
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
            // SDR BT.709 attachments. Phase 3 will switch per HDR mode.
            CVBufferSetAttachment(pb, kCVImageBufferColorPrimariesKey,
                                  kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
            CVBufferSetAttachment(pb, kCVImageBufferTransferFunctionKey,
                                  kCVImageBufferTransferFunction_ITU_R_709_2, .shouldPropagate)
            CVBufferSetAttachment(pb, kCVImageBufferYCbCrMatrixKey,
                                  kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
            let img = try bridge.makeImageFromIOSurface(
                surface, width: UInt32(width), height: UInt32(height),
                format: VK_FORMAT_B8G8R8A8_UNORM
            )
            ring.append(RingEntry(ioSurface: surface, pixelBuffer: pb, vkImage: img))
        }
        ringWidth = width
        ringHeight = height
    }

    private func registerPool(
        width: Int, height: Int, mpv: OpaquePointer, bridge: MpvVulkanBridge
    ) throws {
        // Stable storage for arrays mpv will reference until
        // mpv_libmpv_apple_clear_pool / detach.
        poolImages = ring.map { Optional($0.vkImage) }
        deviceExtCStrings = MpvVulkanBridge.enabledDeviceExtensions.map {
            strdup($0)
        }
        deviceExtPtrs = deviceExtCStrings.map { UnsafePointer($0) }

        // Retain self for the C callback bridge. Released in tearDown.
        let retainer = Unmanaged.passRetained(self)
        poolSelfRetainer = retainer

        // Color metadata: SDR BT.709, full-range RGB. Numeric values
        // match libplacebo's pl_color_primaries / pl_color_transfer /
        // pl_color_system enums (see render_libmpv_apple.h).
        let plColorPrimBT709: Int32 = 7   // PL_COLOR_PRIM_BT_709
        let plColorTrcBT1886: Int32 = 8   // PL_COLOR_TRC_BT_1886
        let plColorSysRGB: Int32 = 1      // PL_COLOR_SYSTEM_RGB

        let usage: VkImageUsageFlags = VkImageUsageFlags(
            VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT.rawValue
            | VK_IMAGE_USAGE_TRANSFER_DST_BIT.rawValue
            | VK_IMAGE_USAGE_TRANSFER_SRC_BIT.rawValue
            | VK_IMAGE_USAGE_SAMPLED_BIT.rawValue
        )

        var rc: Int32 = 0
        poolImages.withUnsafeMutableBufferPointer { imgBuf in
            deviceExtPtrs.withUnsafeMutableBufferPointer { extBuf in
                var params = mpv_libmpv_apple_pool_params(
                    instance: bridge.instance,
                    phys_device: bridge.physicalDevice,
                    device: bridge.device,
                    get_proc_addr: MpvVulkanBridge.getInstanceProcAddrFnPointer,
                    queue_family_index: bridge.queueFamilyIndex,
                    queue_index: bridge.queueIndex,
                    device_extensions: extBuf.baseAddress,
                    num_device_extensions: Int32(extBuf.count),
                    num_images: Int32(imgBuf.count),
                    images: imgBuf.baseAddress,
                    format: VK_FORMAT_B8G8R8A8_UNORM,
                    width: Int32(width),
                    height: Int32(height),
                    usage: usage,
                    color_primaries: plColorPrimBT709,
                    color_transfer: plColorTrcBT1886,
                    color_system: plColorSysRGB,
                    swapchain_depth: 2,
                    acquire: MpvMetalView.acquireCb,
                    present: MpvMetalView.presentCb,
                    priv: retainer.toOpaque()
                )
                rc = mpv_libmpv_apple_set_pool(mpv, &params)
            }
        }
        if rc < 0 {
            throw MpvVulkanBridgeError.vk(VK_ERROR_INITIALIZATION_FAILED,
                                          "mpv_libmpv_apple_set_pool returned \(rc)")
        }
    }

    // MARK: Acquire / present (called from mpv's render thread)

    /// Round-robin pick. Atomic CAS-free monotonic counter mod ringSize.
    private func acquire(outIndex: UnsafeMutablePointer<Int32>) -> Bool {
        let next = OSAtomicIncrement32(&nextRingIndex)
        outIndex.pointee = next.modulo(Int32(MpvMetalView.poolSize))
        return true
    }

    /// Hand the freshly-rendered IOSurface to AVSBDL. Called from
    /// mpv's render thread; bounce to main for `enqueueSampleBuffer:`.
    private func present(index: Int, semaphore _: VkSemaphore?) {
        // TODO Phase 1B+: bridge `semaphore` → MTLSharedEvent so AVSBDL
        // sees the IOSurface only after the GPU has finished writing it.
        // For now we trust the GPU work to complete before the next
        // VSync — works on Apple Silicon at 1080p; revisit on first
        // tearing report.
        guard index >= 0, index < ring.count else { return }
        let pb = ring[index].pixelBuffer
        DispatchQueue.main.async { [weak self] in
            self?.enqueuer?.enqueue(pixelBuffer: pb)
        }
    }

    // MARK: PiP / control timebase (unchanged from Phase 1A)

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
            CMTimebaseSetTime(tb, time: CMTime(seconds: position, preferredTimescale: 600))
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
            // Tell mpv to stop calling our acquire/present. Must happen
            // before we destroy VkImages or unretain the pool priv.
            if let mpv = attachedMpv {
                mpv_libmpv_apple_clear_pool(mpv)
            }

            pipController = nil
            if let tb = controlTimebase {
                CMTimebaseSetRate(tb, rate: 0)
            }
            sampleBufferLayer.controlTimebase = nil
            controlTimebase = nil
            lastInvalidatedDuration = -1
            lastInvalidatedPaused = true
            lastInvalidatedRate = -1

            enqueuer = nil

            if let bridge = vulkanBridge {
                for entry in ring { bridge.destroyImage(entry.vkImage) }
            }
            ring.removeAll(keepingCapacity: false)
            ringWidth = 0
            ringHeight = 0
            nextRingIndex = 0

            vulkanBridge = nil
            poolImages.removeAll(keepingCapacity: false)
            for ptr in deviceExtCStrings { free(ptr) }
            deviceExtCStrings.removeAll(keepingCapacity: false)
            deviceExtPtrs.removeAll(keepingCapacity: false)

            poolSelfRetainer?.release()
            poolSelfRetainer = nil

            attachedPlayer?.unregisterView(self)
            attachedPlayer = nil
            attachedMpv = nil

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

    // MARK: C callbacks

    /// Pool size constant — number of IOSurfaces we round-robin
    /// through. Must be ≥ swapchain_depth + 1 to keep AVSBDL's display
    /// hold from overlapping with libplacebo's writes.
    static let poolSize: Int = 3

    private static let acquireCb: (
        @convention(c) (UnsafeMutableRawPointer?, UnsafeMutablePointer<Int32>?) -> Bool
    ) = { priv, outIdx in
        guard let priv = priv, let outIdx = outIdx else { return false }
        let view = Unmanaged<MpvMetalView>.fromOpaque(priv).takeUnretainedValue()
        return view.acquire(outIndex: outIdx)
    }

    private static let presentCb: (
        @convention(c) (UnsafeMutableRawPointer?, Int32, VkSemaphore?) -> Void
    ) = { priv, idx, sem in
        guard let priv = priv else { return }
        let view = Unmanaged<MpvMetalView>.fromOpaque(priv).takeUnretainedValue()
        view.present(index: Int(idx), semaphore: sem)
    }
}

// MARK: - PiP delegates (unchanged from Phase 1A)

@available(iOS 15.0, *)
extension MpvMetalView: AVPictureInPictureControllerDelegate {
    func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        isPipActive = true
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        isPipActive = false
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
        _ controller: AVPictureInPictureController, setPlaying playing: Bool
    ) {
        guard let player = attachedPlayer else { return }
        do {
            if playing { try player.play() } else { try player.pause() }
        } catch {
            NSLog("[MpvMetalView] PiP setPlaying error: %@", String(describing: error))
        }
    }

    func pictureInPictureControllerTimeRangeForPlayback(_ controller: AVPictureInPictureController) -> CMTimeRange {
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

    func pictureInPictureControllerIsPlaybackPaused(_ controller: AVPictureInPictureController) -> Bool {
        return attachedPlayer?.pipIsPaused ?? true
    }

    func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        didTransitionToRenderSize newRenderSize: CMVideoDimensions
    ) {}

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

private extension Int32 {
    /// Always-positive modulo. Swift's `%` returns negative results for
    /// negative dividends; OSAtomicIncrement32 wraps to negative once
    /// it overflows past Int32.max, so we need this guard.
    func modulo(_ n: Int32) -> Int32 {
        let r = self % n
        return r < 0 ? r + n : r
    }
}
