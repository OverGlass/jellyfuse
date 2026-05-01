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
    let vkMemory: VkDeviceMemory
    let mtlTexture: MTLTexture
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
        // Phase 3 step 3+4: EDR display mode. Tells the OS this layer can
        // drive the panel above SDR brightness (~1000-1200 nits on Super
        // Retina XDR). For SDR-source content the underlying PQ values
        // sit in the SDR luminance band (~100 nits), so the panel still
        // shows SDR content at SDR brightness — the EDR mode is the
        // ceiling, not the floor. Ignored gracefully on non-EDR
        // displays (none exist on iPhone X+ shipping today).
        //
        // wantsExtendedDynamicRangeContent on AVSampleBufferDisplayLayer
        // is iOS 17+; toneMapMode is iOS 18+. Below those versions, EDR
        // signaling falls back to per-CMSampleBuffer color attachments
        // alone — the OS still recognises the BT.2020 / SMPTE_ST_2084
        // tags on the buffer and lifts the layer into EDR composition.
        if #available(iOS 17.0, *) {
            sampleBufferLayer.wantsExtendedDynamicRangeContent = true
        }
        if #available(iOS 18.0, *) {
            sampleBufferLayer.toneMapMode = .automatic
        }
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
        // Pool is registered — let mpv create the vo. Until this call
        // mpv was started with `vid=no`, which deferred vo_create.
        player.activateVideoOutput()

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
        // Phase 3 step 3+4: HDR-capable output pool.
        //
        // Output format: 16-bit half-float RGBA. libplacebo emits
        // BT.2020 / PQ-encoded values into this buffer. AVSBDL with
        // wantsExtendedDynamicRangeContent=true reads PQ values per
        // CMSampleBuffer color attachments and drives the EDR-capable
        // panel (XDR on iPhone X+, all modern iPhones) up to the panel's
        // HDR peak (~1000-1200 nits on iPhone 13 mini).
        //
        // Always-PQ output handles all source HDR modes correctly:
        //   - SDR (BT.1886): libplacebo encodes SDR values as low-nit
        //     PQ levels (~100 nits peak). Display matches SDR brightness.
        //   - HDR10 (PQ): pass-through (or tone-map for headroom).
        //     Display at full HDR.
        //   - HLG: libplacebo converts HLG → PQ. Display at full HDR.
        //
        // No mid-stream pool rebuild needed — the EDR pipeline is mode-
        // agnostic at the AVSBDL layer; the encoded pixel values dictate
        // the actual displayed brightness.
        //
        // Memory: 5 slots × 1920×1080 × 8 bytes = ~80 MB (vs ~40 MB BGRA8).
        // Acceptable for the brightness win on EDR panels.
        let bytesPerRow = width * 8
        let attrs: [String: Any] = [
            kIOSurfaceWidth as String: width,
            kIOSurfaceHeight as String: height,
            kIOSurfaceBytesPerElement as String: 8,
            kIOSurfaceBytesPerRow as String: bytesPerRow,
            kIOSurfacePixelFormat as String: Int(kCVPixelFormatType_64RGBAHalf),
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
            // BT.2020 / PQ color tags on the CVPixelBuffer propagate to
            // the CMSampleBuffer that AVSBDL displays. We do NOT set
            // YCbCrMatrix — the format is RGBA, no chroma planes.
            CVBufferSetAttachment(pb, kCVImageBufferColorPrimariesKey,
                                  kCVImageBufferColorPrimaries_ITU_R_2020, .shouldPropagate)
            CVBufferSetAttachment(pb, kCVImageBufferTransferFunctionKey,
                                  kCVImageBufferTransferFunction_SMPTE_ST_2084_PQ, .shouldPropagate)
            let owned = try bridge.makeImageFromIOSurface(
                surface, width: UInt32(width), height: UInt32(height),
                format: VK_FORMAT_R16G16B16A16_SFLOAT
            )
            ring.append(RingEntry(
                ioSurface: surface,
                pixelBuffer: pb,
                vkImage: owned.image,
                vkMemory: owned.memory,
                mtlTexture: owned.mtlTexture
            ))
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

        // Phase 3 step 3+4: BT.2020 / PQ output. libplacebo emits
        // PQ-encoded values into the RGBA16F pool. Both SDR and HDR
        // sources route through the same target — SDR gets encoded at
        // SDR-luminance PQ levels (~100 nits), HDR at full HDR levels
        // (up to 1000+ nits).
        //
        // Numeric values match libplacebo's pl_color_primaries /
        // pl_color_transfer / pl_color_system enums (libplacebo/colorspace.h).
        let plColorPrimBT2020: Int32 = 6   // PL_COLOR_PRIM_BT_2020
        let plColorTrcPQ: Int32 = 12       // PL_COLOR_TRC_PQ
        let plColorSysRGB: Int32 = 12      // PL_COLOR_SYSTEM_RGB

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
                    format: VK_FORMAT_R16G16B16A16_SFLOAT,
                    width: Int32(width),
                    height: Int32(height),
                    usage: usage,
                    color_primaries: plColorPrimBT2020,
                    color_transfer: plColorTrcPQ,
                    color_system: plColorSysRGB,
                    swapchain_depth: 2,
                    acquire: MpvMetalView.acquireCb,
                    present: MpvMetalView.presentCb,
                    destroy: MpvMetalView.destroyCb,
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

    /// Serial worker for the GPU wait. Moves `vkDeviceWaitIdle` off mpv's
    /// render thread so mpv can pipeline the next frame while we're
    /// waiting for the current frame's writes to land. Serial ordering is
    /// load-bearing — AVSBDL relies on CMSampleBuffer enqueue order
    /// matching frame order for PTS sequencing.
    private static let presentWaitQueue = DispatchQueue(
        label: "jellyfuse.native-mpv.present-wait", qos: .userInteractive
    )

    /// Hand the freshly-rendered IOSurface to AVSBDL. Called from mpv's
    /// render thread; the wait + main hop run on a worker queue so the
    /// render thread returns immediately and mpv can keep pipelining.
    private func present(index: Int, semaphore _: VkSemaphore?) {
        guard index >= 0, index < ring.count else { return }
        let pb = ring[index].pixelBuffer
        let device = vulkanBridge?.device

        MpvMetalView.presentWaitQueue.async { [weak self] in
            // Wait for libplacebo's GPU writes to land before AVSBDL
            // reads the IOSurface. vkDeviceWaitIdle is the sledgehammer
            // — a per-frame fence wait would be tighter, but only by
            // microseconds on a single-queue workload, and it'd require
            // injecting a VkFence + dummy submit per present. Phase
            // follow-up if we ever need it.
            if let device = device { vkDeviceWaitIdle(device) }
            DispatchQueue.main.async { [weak self] in
                self?.enqueuer?.enqueue(pixelBuffer: pb)
            }
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

    /// Phase 3 step 2: receive the source HDR classification from
    /// HybridNativeMpv. Stub for now — step 3 will set
    /// `wantsExtendedDynamicRangeContent` and `CAEDRMetadata` here, and
    /// step 4 will trigger a P010 ring rebuild on the first
    /// `.hdr10` / `.hlg` transition.
    private var currentHdrMode: MpvHdrMode = .sdr
    func applyHdrMode(_ mode: MpvHdrMode) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard mode != currentHdrMode else { return }
        currentHdrMode = mode
        NSLog("[MpvMetalView] hdr mode → %@", String(describing: mode))
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
        // Set up the sync handoff before issuing clear_pool/stop. The
        // destroyCb fires on mpv's render thread once the ra_ctx is
        // fully torn down (i.e. no more Vulkan submits incoming), and
        // signals this semaphore. We wait below on a worker queue
        // before letting tearDown return to its caller.
        let mpvAlive = attachedPlayer?.mpvHandle != nil
        let semaphore: DispatchSemaphore? = mpvAlive ? DispatchSemaphore(value: 0) : nil
        if let s = semaphore { destroySemaphore = s }

        let work = { [self] in
            // Tell mpv to stop rendering into our pool. The actual
            // teardown of mpv's ra_ctx (and the matching release of
            // the +1 retain we handed it as the pool's `priv`) happens
            // asynchronously inside mpv via the `destroyCb` callback,
            // which lets MetalView's `deinit` finally free the ring +
            // bridge without racing the render thread.
            //
            // Reach the mpv handle through the weak `attachedPlayer`
            // ref, NOT via the cached `attachedMpv` raw pointer:
            // `HybridNativeMpv` may have already been deallocated by
            // the time `onDropView` reaches us on nav-back. The cached
            // pointer would be a dangling reference and `mpv_command`
            // would dereference it (EXC_BAD_ACCESS in
            // `run_client_command`).
            if let mpv = attachedPlayer?.mpvHandle {
                mpv_libmpv_apple_clear_pool(mpv)

                let stop = strdup("stop")
                var args: [UnsafePointer<CChar>?] = [
                    UnsafePointer(stop), nil,
                ]
                _ = mpv_command(mpv, &args)
                free(stop)
            } else if let r = poolSelfRetainer {
                // Player already gone: the ra_ctx will never tear down
                // and `destroyCb` will never fire, so the +1 retain we
                // handed mpv as `priv` would leak forever. Release it
                // here — there's no race because mpv core is dead.
                r.release()
                poolSelfRetainer = nil
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

            // The ring (IOSurfaces + VkImages + CVPixelBuffers), the
            // Vulkan bridge, the pool-extension cstrings, and the
            // pool-self retainer all stay alive past tearDown — mpv's
            // render thread may still call acquire/present in the
            // window between view dismount and `mpv_command "stop"`
            // draining the vo. They're released in `deinit` once the
            // ra_ctx's destroy callback (`destroyCb`) has dropped the
            // +1 retain we handed mpv at `mpv_libmpv_apple_set_pool`
            // time. Releasing them here is the use-after-free that
            // crashed the app on nav-back from the player.

            attachedPlayer?.unregisterView(self)
            attachedPlayer = nil

            sampleBufferLayer.flushAndRemoveImage()
        }

        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.sync { work() }
        }

        // Block briefly until mpv's destroyCb fires (ra_ctx torn down,
        // no more Vulkan submits incoming). Without this, the React
        // view tree starts deallocating while mpv's render thread is
        // still mid-render — the documented use-after-free where a
        // sibling RCTViewComponentView's _backgroundColorLayer gets
        // released into corrupted state on nav-back.
        //
        // 500 ms is plenty for mpv to drain its render queue at the
        // point we ask it to stop (the work in flight is at most one
        // frame's render). On timeout we proceed anyway — preferable
        // to deadlocking nav-back if mpv ever wedges. Won't block the
        // main thread because the wait runs on a worker queue when
        // tearDown was invoked off-main; on-main tearDown (rare —
        // typically triggered from JS thread) will briefly block, but
        // bounded.
        if let s = semaphore {
            let result = s.wait(timeout: .now() + .milliseconds(500))
            if result == .timedOut {
                NSLog("[MpvMetalView] tearDown wait timed out — mpv vo destroy still pending")
            }
            destroySemaphore = nil
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        // Heavy resources are deferred from tearDown to here — by the
        // time `deinit` fires, mpv has already released its +1 retain
        // (via the `destroyCb` ra_ctx tear-down callback), so no more
        // acquire/present callbacks can fire and the pool's VkImages /
        // IOSurfaces are safe to free.
        if let bridge = vulkanBridge {
            for entry in ring {
                bridge.destroyImage(MpvIOSurfaceVkImage(
                    image: entry.vkImage,
                    memory: entry.vkMemory,
                    mtlTexture: entry.mtlTexture
                ))
            }
        }
        ring.removeAll(keepingCapacity: false)
        vulkanBridge = nil
        poolImages.removeAll(keepingCapacity: false)
        for ptr in deviceExtCStrings { free(ptr) }
        deviceExtCStrings.removeAll(keepingCapacity: false)
        deviceExtPtrs.removeAll(keepingCapacity: false)
        // (Removed the `sampleBufferLayer.controlTimebase = nil`
        // defensive write — that's a CALayer property setter, and
        // deinit may run on whatever thread releases the last retain.
        // tearDown handles this on the main thread; if tearDown didn't
        // run, the CALayer is being deinit'd anyway and clearing it is
        // moot. Keeping it here was the documented source of the
        // nav-back UAF — see `destroyCb` for the full chain.)
    }

    // MARK: C callbacks

    /// Pool size constant — number of IOSurfaces we round-robin
    /// through. Must be ≥ swapchain_depth + 1 to keep AVSBDL's display
    /// hold from overlapping with libplacebo's writes.
    ///
    /// At 4K with HDR tone-mapping, per-frame libplacebo render takes
    /// long enough that swapchain_depth (2) + AVSBDL display queue (≥ 1
    /// when the display engine briefly stalls) can saturate a 3-slot
    /// ring and cause torn frames. 5 slots gives enough headroom for
    /// 24 fps 4K HEVC10 + tone-map without observable glitches.
    /// Memory cost: 5 × 1920 × 1080 × 4 ≈ 40 MB.
    static let poolSize: Int = 5

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

    /// Mpv signals end-of-vo via this callback. We hold a +1 retain on
    /// `self` for the lifetime of the registered pool (passed to
    /// `mpv_libmpv_apple_set_pool` as `priv`); release it here so the
    /// MetalView can finally deinit. Fires from mpv's render thread.
    ///
    /// IMPORTANT: the release is dispatched to the main thread. If it
    /// drops the last reference to MpvMetalView, `deinit` runs there
    /// — and `deinit` touches CALayer state
    /// (`sampleBufferLayer.controlTimebase = nil`) and releases
    /// CVPixelBuffers which interact with CARenderServer. CALayer ops
    /// from non-main threads corrupt sibling layers' state, which is
    /// the documented nav-back UAF in
    /// `project_rctswiftui_duplicate_class.md`: a sibling
    /// RCTViewComponentView's `_backgroundColorLayer` is freed mid-
    /// render, and the autorelease pool drain later faults trying to
    /// release the stale ivar.
    ///
    /// Signal the semaphore first (so `tearDown`'s sync wait can
    /// return) and then bounce the actual release to main.
    private static let destroyCb: (
        @convention(c) (UnsafeMutableRawPointer?) -> Void
    ) = { priv in
        guard let priv = priv else { return }
        let view = Unmanaged<MpvMetalView>.fromOpaque(priv).takeUnretainedValue()
        view.destroySemaphore?.signal()
        DispatchQueue.main.async {
            Unmanaged<MpvMetalView>.fromOpaque(priv).release()
        }
    }

    /// Set by `tearDown` before issuing `clear_pool` / `stop`; signaled
    /// by `destroyCb` once mpv's ra_ctx has fully torn down. tearDown
    /// blocks on this for a bounded interval so mpv's render thread
    /// stops issuing Vulkan submits before the React view tree starts
    /// dealloc — addresses the long-standing nav-back crash where a
    /// sibling `RCTViewComponentView`'s `_backgroundColorLayer` gets
    /// freed while mpv is mid-render.
    fileprivate var destroySemaphore: DispatchSemaphore?
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
