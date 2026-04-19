//
//  HybridMpvVideoView.swift
//  @jellyfuse/native-mpv — iOS video render surface
//
//  One render pipeline, one layer:
//
//     mpv_render_context   (OpenGL ES, off-screen)
//         │
//         ▼
//     CVPixelBuffer        (BGRA, IOSurface-backed, pooled)
//         │
//         ▼
//     CMSampleBuffer  ───► AVSampleBufferDisplayLayer   (our root layer)
//                                │
//                                └──► AVPictureInPictureController
//                                     (auto-PiP on backgrounding)
//
//  OpenGL ES stays inside `mpv_render_context` because that is the
//  render API libmpv supports on iOS. We do NOT ship GL to the
//  compositor — the display boundary is `AVSampleBufferDisplayLayer`,
//  the same layer iOS reads for PiP. One render per vsync feeds both
//  the on-screen view and the floating window.
//
//  Background rendering: `presentRenderbuffer` is blocked when
//  backgrounded, but IOSurface-backed submissions are not, so the
//  render loop keeps going during PiP without the GPU-in-background
//  error. When backgrounded *without* PiP we still pause the display
//  link to conserve battery.
//

import AVFoundation
import AVKit
import CoreMedia
import CoreVideo
import Foundation
import Libmpv
import NitroModules
import OpenGLES
import QuartzCore

// MARK: - MpvGLView

/// UIView whose root layer is an `AVSampleBufferDisplayLayer`. Owns
/// the EAGLContext, mpv render context, pixel-buffer pool, display
/// link, and PiP controller. `HybridMpvVideoView` (the Nitro
/// HybridView wrapper) delegates lifecycle here.
final class MpvGLView: UIView {

    // ── Root layer ──────────────────────────────────────────────────────
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }

    private var sampleBufferLayer: AVSampleBufferDisplayLayer {
        return layer as! AVSampleBufferDisplayLayer
    }

    // ── GL (off-screen FBO path only) ───────────────────────────────────
    private var eaglContext: EAGLContext?
    private var textureCache: CVOpenGLESTextureCache?
    private var framebuffer: GLuint = 0

    // ── mpv render context ──────────────────────────────────────────────
    private var renderCtx: OpaquePointer?
    private var mpvHandle: OpaquePointer?
    private weak var attachedPlayer: HybridNativeMpv?

    // ── Display link ────────────────────────────────────────────────────
    private var displayLink: CADisplayLink?
    // Set from mpv's update-callback thread, read from main. Plain
    // `Bool` was a data race that stalled the render loop after
    // minutes of playback.
    private var _needsRender: Bool = false
    private var renderLock = os_unfair_lock()

    private var needsRender: Bool {
        get {
            os_unfair_lock_lock(&renderLock)
            let val = _needsRender
            os_unfair_lock_unlock(&renderLock)
            return val
        }
        set {
            os_unfair_lock_lock(&renderLock)
            _needsRender = newValue
            os_unfair_lock_unlock(&renderLock)
        }
    }

    // ── Pixel-buffer pool ───────────────────────────────────────────────
    private var pixelBufferPool: CVPixelBufferPool?
    private var poolWidth: Int = 0
    private var poolHeight: Int = 0

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
        // Keep rendering if a PiP session is about to / is already
        // running — its window is the only live consumer of our
        // sample-buffer layer once the app is backgrounded. Otherwise
        // pause to save battery.
        if !shouldKeepRenderingInBackground() {
            displayLink?.isPaused = true
        }
    }

    @objc private func handleWillEnterForeground() {
        isAppInBackground = false
        displayLink?.isPaused = false
        needsRender = true
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

    /// Connect to an mpv player instance and start rendering video.
    func attach(player: HybridNativeMpv, mpvHandle handle: OpaquePointer) {
        guard renderCtx == nil else { return }
        mpvHandle = handle
        attachedPlayer = player
        player.registerView(self)

        // 1. EAGLContext — off-screen only, no drawable.
        if let ctx = EAGLContext(api: .openGLES3) {
            eaglContext = ctx
        } else if let ctx = EAGLContext(api: .openGLES2) {
            eaglContext = ctx
        } else {
            NSLog("[MpvGLView] Failed to create EAGLContext")
            return
        }
        EAGLContext.setCurrent(eaglContext)

        // 2. Shared OpenGL ES texture cache — wraps each pooled pixel
        //    buffer as a GL texture with no CPU copy (IOSurface path).
        guard let eaglContext = eaglContext else { return }
        var cache: CVOpenGLESTextureCache?
        let cacheRc = CVOpenGLESTextureCacheCreate(
            kCFAllocatorDefault, nil, eaglContext, nil, &cache
        )
        if cacheRc != kCVReturnSuccess {
            NSLog("[MpvGLView] CVOpenGLESTextureCacheCreate failed: %d", cacheRc)
            tearDown()
            return
        }
        textureCache = cache

        // 3. FBO reused every frame. Its color attachment is set
        //    lazily per frame to whichever pooled pixel buffer we're
        //    rendering into.
        glGenFramebuffers(1, &framebuffer)

        // 4. mpv render context.
        guard createRenderContext(mpv: handle) else {
            NSLog("[MpvGLView] Failed to create mpv render context")
            tearDown()
            return
        }

        // 5. Enable video + unpause. mpv was initialised with
        //    pause=yes to avoid freezing while vo=libmpv had no
        //    render context.
        mpv_set_property_string(handle, "vid", "auto")
        mpv_set_property_string(handle, "pause", "no")

        // 6. Render loop.
        startDisplayLink()

        // 7. Control timebase — must be set on the layer BEFORE the
        //    PiP controller is created, otherwise the controller
        //    caches the "no timebase" state and skip buttons stay
        //    disabled for the life of the PiP session.
        setupControlTimebase()

        // 8. PiP controller — iOS 15+ custom-source. The controller
        //    observes our sample-buffer layer, so the same frames we
        //    show on-screen are the frames iOS shows in the floating
        //    window.
        setupPipController()
    }

    /// Disconnect from the player. Tears down GL + render context.
    func detach() {
        tearDown()
    }

    // MARK: - mpv render context

    private func createRenderContext(mpv: OpaquePointer) -> Bool {
        EAGLContext.setCurrent(eaglContext)

        // Resolves GLES function pointers for libmpv.
        let getProcAddress: @convention(c) (
            UnsafeMutableRawPointer?,
            UnsafePointer<CChar>?
        ) -> UnsafeMutableRawPointer? = { _, name in
            guard let name = name else { return nil }
            return dlsym(UnsafeMutableRawPointer(bitPattern: -2), name)
        }

        var initParams = mpv_opengl_init_params(
            get_proc_address: getProcAddress,
            get_proc_address_ctx: nil
        )

        let apiType = strdup("opengl")!
        defer { free(apiType) }

        var ctx: OpaquePointer?
        let rc = withUnsafeMutablePointer(to: &initParams) { initParamsPtr -> Int32 in
            var params: [mpv_render_param] = [
                mpv_render_param(
                    type: MPV_RENDER_PARAM_API_TYPE,
                    data: UnsafeMutableRawPointer(apiType)
                ),
                mpv_render_param(
                    type: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                    data: UnsafeMutableRawPointer(initParamsPtr)
                ),
                mpv_render_param(type: mpv_render_param_type(rawValue: 0), data: nil),
            ]
            return mpv_render_context_create(&ctx, mpv, &params)
        }
        if rc < 0 {
            NSLog("[MpvGLView] mpv_render_context_create failed: %d (%s)",
                  rc, String(cString: mpv_error_string(rc)))
            return false
        }
        renderCtx = ctx

        // Update callback fires off-thread whenever mpv has a new
        // frame. Flip the flag; the next CADisplayLink tick renders.
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        mpv_render_context_set_update_callback(ctx, { ctx in
            guard let ctx = ctx else { return }
            let view = Unmanaged<MpvGLView>.fromOpaque(ctx).takeUnretainedValue()
            view.needsRender = true
        }, selfPtr)
        return true
    }

    // MARK: - Display link

    private func startDisplayLink() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(renderFrame))
        if UIScreen.main.maximumFramesPerSecond >= 120 {
            link.preferredFramesPerSecond = 120
        }
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func renderFrame() {
        // Gate all work on the update-callback flag. For 24fps video
        // this skips ~96 of 120 display-link ticks (nearly free).
        guard needsRender, let renderCtx = renderCtx else { return }
        needsRender = false

        let flags = mpv_render_context_update(renderCtx)
        guard flags & UInt64(MPV_RENDER_UPDATE_FRAME.rawValue) != 0 else { return }

        guard let eaglContext = eaglContext else { return }
        EAGLContext.setCurrent(eaglContext)

        renderAndEnqueue(renderCtx: renderCtx)
    }

    // MARK: - Render + enqueue

    /// Single pass: pool → CVPixelBuffer (IOSurface-backed) → GL
    /// texture → FBO → mpv renders → CMSampleBuffer → enqueue. One
    /// GPU submission per vsync feeds both the on-screen layer and
    /// the PiP window.
    private func renderAndEnqueue(renderCtx: OpaquePointer) {
        // 1. Resize the pool when mpv's decoded size becomes known or
        //    changes (adaptive-bitrate switches, resolution ladders).
        if let (w, h) = readMpvVideoSize() {
            if pixelBufferPool == nil || w != poolWidth || h != poolHeight {
                ensurePool(width: w, height: h)
            }
        }
        guard let pool = pixelBufferPool,
              let cache = textureCache,
              poolWidth > 0, poolHeight > 0 else { return }

        // 2. Acquire a pooled pixel buffer.
        var pixelBuffer: CVPixelBuffer?
        let poolRc = CVPixelBufferPoolCreatePixelBuffer(
            kCFAllocatorDefault, pool, &pixelBuffer
        )
        guard poolRc == kCVReturnSuccess, let pb = pixelBuffer else { return }

        // 3. Tag color space so the sample-buffer layer composites our
        //    BGRA as Rec.709 video rather than guessing.
        tagColorSpace(pb)

        // 4. Wrap as a GL texture via the shared cache. Zero-copy —
        //    the texture references the pixel buffer's IOSurface.
        var texture: CVOpenGLESTexture?
        let texRc = CVOpenGLESTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault, cache, pb, nil,
            GLenum(GL_TEXTURE_2D), GL_RGBA,
            GLsizei(poolWidth), GLsizei(poolHeight),
            GLenum(GL_BGRA), GLenum(GL_UNSIGNED_BYTE),
            0, &texture
        )
        guard texRc == kCVReturnSuccess, let tex = texture else { return }
        let texTarget = CVOpenGLESTextureGetTarget(tex)
        let texName = CVOpenGLESTextureGetName(tex)

        // 5. Bind texture as the FBO's color attachment.
        glBindFramebuffer(GLenum(GL_FRAMEBUFFER), framebuffer)
        glBindTexture(texTarget, texName)
        glTexParameteri(texTarget, GLenum(GL_TEXTURE_MIN_FILTER), GL_LINEAR)
        glTexParameteri(texTarget, GLenum(GL_TEXTURE_MAG_FILTER), GL_LINEAR)
        glTexParameteri(texTarget, GLenum(GL_TEXTURE_WRAP_S), GL_CLAMP_TO_EDGE)
        glTexParameteri(texTarget, GLenum(GL_TEXTURE_WRAP_T), GL_CLAMP_TO_EDGE)
        glFramebufferTexture2D(
            GLenum(GL_FRAMEBUFFER),
            GLenum(GL_COLOR_ATTACHMENT0),
            texTarget, texName, 0
        )

        let status = glCheckFramebufferStatus(GLenum(GL_FRAMEBUFFER))
        guard status == GLenum(GL_FRAMEBUFFER_COMPLETE) else {
            NSLog("[MpvGLView] FBO incomplete: 0x%X", status)
            glFramebufferTexture2D(
                GLenum(GL_FRAMEBUFFER),
                GLenum(GL_COLOR_ATTACHMENT0),
                GLenum(GL_TEXTURE_2D), 0, 0
            )
            return
        }

        // 6. Tell mpv to render into the FBO. `FLIP_Y=0` — sample
        //    buffer layers use top-left origin (unlike CAEAGLLayer,
        //    which needed a flip).
        var fbo = mpv_opengl_fbo(
            fbo: Int32(framebuffer),
            w: Int32(poolWidth),
            h: Int32(poolHeight),
            internal_format: 0
        )
        var flipY: Int32 = 0

        withUnsafeMutablePointer(to: &fbo) { fboPtr in
            withUnsafeMutablePointer(to: &flipY) { flipYPtr in
                var renderParams: [mpv_render_param] = [
                    mpv_render_param(
                        type: MPV_RENDER_PARAM_OPENGL_FBO,
                        data: UnsafeMutableRawPointer(fboPtr)
                    ),
                    mpv_render_param(
                        type: MPV_RENDER_PARAM_FLIP_Y,
                        data: UnsafeMutableRawPointer(flipYPtr)
                    ),
                    mpv_render_param(type: mpv_render_param_type(rawValue: 0), data: nil),
                ]
                mpv_render_context_render(renderCtx, &renderParams)
            }
        }
        glFlush()

        // Detach texture so the FBO doesn't retain it after `tex`
        // goes out of scope.
        glFramebufferTexture2D(
            GLenum(GL_FRAMEBUFFER),
            GLenum(GL_COLOR_ATTACHMENT0),
            GLenum(GL_TEXTURE_2D), 0, 0
        )

        // 7. Wrap as CMSampleBuffer + enqueue. Flush first if the
        //    layer wants it (iOS 14+ — rebuffer after failed decode).
        guard let sampleBuffer = makeSampleBuffer(from: pb) else { return }
        let sbLayer = sampleBufferLayer
        if #available(iOS 14.0, *), sbLayer.requiresFlushToResumeDecoding {
            sbLayer.flush()
        }
        if sbLayer.isReadyForMoreMediaData {
            sbLayer.enqueue(sampleBuffer)
        }
    }

    // MARK: - Helpers

    /// Create or resize the pixel-buffer pool. Returns true when the
    /// pool is ready at the requested dimensions.
    ///
    /// BGRA + IOSurface-backed so each pixel buffer is zero-copy
    /// wrappable as a GL texture.
    @discardableResult
    private func ensurePool(width: Int, height: Int) -> Bool {
        guard width > 0, height > 0 else { return false }
        if pixelBufferPool != nil, poolWidth == width, poolHeight == height {
            return true
        }
        if let cache = textureCache {
            CVOpenGLESTextureCacheFlush(cache, 0)
        }
        pixelBufferPool = nil

        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            kCVPixelBufferOpenGLESCompatibilityKey as String: true,
        ]
        var pool: CVPixelBufferPool?
        let rc = CVPixelBufferPoolCreate(
            kCFAllocatorDefault, nil, attrs as CFDictionary, &pool
        )
        guard rc == kCVReturnSuccess, let created = pool else {
            NSLog("[MpvGLView] CVPixelBufferPoolCreate failed: %d", rc)
            return false
        }
        pixelBufferPool = created
        poolWidth = width
        poolHeight = height
        return true
    }

    /// Read the current video display size from mpv (`dwidth` /
    /// `dheight`). `nil` when mpv hasn't produced a frame yet —
    /// caller retries next tick.
    private func readMpvVideoSize() -> (Int, Int)? {
        guard let mpv = mpvHandle else { return nil }
        var w: Int64 = 0
        var h: Int64 = 0
        guard mpv_get_property(mpv, "dwidth", MPV_FORMAT_INT64, &w) >= 0 else { return nil }
        guard mpv_get_property(mpv, "dheight", MPV_FORMAT_INT64, &h) >= 0 else { return nil }
        guard w > 0, h > 0 else { return nil }
        return (Int(w), Int(h))
    }

    /// Attach Rec.709 primaries + transfer function to each pixel
    /// buffer. Without these, `AVSampleBufferDisplayLayer` may treat
    /// our BGRA as untagged and shift colors at composition time.
    /// The YCbCr matrix key doesn't apply — we deliver BGRA (RGB
    /// already, post-libmpv color conversion).
    private func tagColorSpace(_ pb: CVPixelBuffer) {
        CVBufferSetAttachment(
            pb,
            kCVImageBufferColorPrimariesKey,
            kCVImageBufferColorPrimaries_ITU_R_709_2,
            .shouldPropagate
        )
        CVBufferSetAttachment(
            pb,
            kCVImageBufferTransferFunctionKey,
            kCVImageBufferTransferFunction_ITU_R_709_2,
            .shouldPropagate
        )
    }

    /// Wrap a pixel buffer as a `CMSampleBuffer` with a host-clock
    /// PTS and the `DisplayImmediately` attachment so iOS composites
    /// without queueing on timing.
    private func makeSampleBuffer(from pixelBuffer: CVPixelBuffer) -> CMSampleBuffer? {
        var formatDescription: CMFormatDescription?
        let fdRc = CMVideoFormatDescriptionCreateForImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescriptionOut: &formatDescription
        )
        guard fdRc == noErr, let fd = formatDescription else { return nil }

        let pts = CMClockGetTime(CMClockGetHostTimeClock())
        var timing = CMSampleTimingInfo(
            duration: .invalid,
            presentationTimeStamp: pts,
            decodeTimeStamp: .invalid
        )

        var sb: CMSampleBuffer?
        let sbRc = CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescription: fd,
            sampleTiming: &timing,
            sampleBufferOut: &sb
        )
        guard sbRc == noErr else { return nil }

        // `CMSampleBufferGetSampleAttachmentsArray` returns an array
        // of `CFMutableDictionary` that toll-free-bridge to
        // `NSMutableDictionary`.
        if let sampleBuffer = sb,
           let attachments = CMSampleBufferGetSampleAttachmentsArray(
               sampleBuffer, createIfNecessary: true
           ) as NSArray?,
           let dict = attachments.firstObject as? NSMutableDictionary {
            dict[kCMSampleAttachmentKey_DisplayImmediately as String] = true
        }
        return sb
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
            NSLog("[MpvGLView] CMTimebaseCreateWithSourceClock failed: %d", rc)
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

    // MARK: - Teardown

    private func tearDown() {
        let work = { [self] in
            // Current the GL context up-front so `mpv_render_context_free`
            // has the right state if libmpv issues any final GL
            // commands during shutdown.
            if let eaglContext = eaglContext {
                EAGLContext.setCurrent(eaglContext)
            }

            displayLink?.invalidate()
            displayLink = nil

            tearDownPipController()

            if let tb = controlTimebase {
                CMTimebaseSetRate(tb, rate: 0)
            }
            sampleBufferLayer.controlTimebase = nil
            controlTimebase = nil
            lastInvalidatedDuration = -1
            lastInvalidatedPaused = true
            lastInvalidatedRate = -1

            if let ctx = renderCtx {
                mpv_render_context_set_update_callback(ctx, nil, nil)
                mpv_render_context_free(ctx)
                renderCtx = nil
            }

            attachedPlayer?.unregisterView(self)
            attachedPlayer = nil
            mpvHandle = nil

            if framebuffer != 0 {
                glDeleteFramebuffers(1, &framebuffer)
                framebuffer = 0
            }
            if let cache = textureCache {
                CVOpenGLESTextureCacheFlush(cache, 0)
            }
            textureCache = nil
            pixelBufferPool = nil
            poolWidth = 0
            poolHeight = 0

            sampleBufferLayer.flushAndRemoveImage()

            EAGLContext.setCurrent(nil)
            eaglContext = nil
            needsRender = false
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
extension MpvGLView: AVPictureInPictureControllerDelegate {
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
        // background, pause the display link — nothing is reading
        // our frames anymore.
        if isAppInBackground {
            displayLink?.isPaused = true
        }
    }

    func pictureInPictureController(
        _ controller: AVPictureInPictureController,
        failedToStartPictureInPictureWithError error: Error
    ) {
        NSLog("[MpvGLView] PiP failed to start: %@", String(describing: error))
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
extension MpvGLView: AVPictureInPictureSampleBufferPlaybackDelegate {
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
            NSLog("[MpvGLView] PiP setPlaying error: %@", String(describing: error))
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
        // No-op. The pool tracks mpv's decode size; iOS downsamples
        // for the PiP window.
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
            NSLog("[MpvGLView] PiP skipByInterval error: %@", String(describing: error))
        }
    }
}

// MARK: - HybridMpvVideoView (Nitro HybridView wrapper)

/// Nitro HybridView wrapping `MpvGLView`. React mounts this as
/// `<MpvVideoView>` and calls `attachPlayer` / `detachPlayer` via
/// the `hybridRef`.
public final class HybridMpvVideoView: HybridMpvVideoViewSpec {

    private let glView = MpvGLView()

    public var view: UIView { return glView }

    public required override init() {
        super.init()
    }

    public func attachPlayer(instanceId: String) throws {
        guard let player = HybridNativeMpv.instance(for: instanceId) else {
            throw RuntimeError("No player with instanceId \(instanceId)")
        }
        guard let handle = player.mpvHandle else {
            throw RuntimeError("Player has been released")
        }
        // Nitro calls hybridRef from the JS thread, but GL setup and
        // `AVPictureInPictureController` construction must run on main.
        DispatchQueue.main.async { [weak self] in
            self?.glView.attach(player: player, mpvHandle: handle)
        }
    }

    public func detachPlayer() throws {
        glView.detach()
    }

    public func onDropView() {
        glView.detach()
    }
}
