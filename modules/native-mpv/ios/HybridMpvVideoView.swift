//
//  HybridMpvVideoView.swift
//  @jellyfuse/native-mpv — iOS GL render surface
//
//  Phase 3b: CAEAGLLayer-backed view + mpv_render_context.
//  Ports the render pattern from the Rust reference
//  `crates/jf-module-player/src/mpv_video_gl.rs` but simplified:
//  renders directly to the CAEAGLLayer's renderbuffer instead of
//  double-buffered CVPixelBuffer → IOSurface → Metal (which GPUI
//  needed but React Native does not).
//
//  Key settings (matching Rust):
//    vo=libmpv          — use render context, not screen output
//    hwdec=videotoolbox-copy — correct YCbCr→RGB color conversion
//    ProMotion 120Hz    — CADisplayLink.preferredFramesPerSecond
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

// MARK: - MpvGLView (UIView with CAEAGLLayer)

/// Internal UIView subclass that owns the EAGLContext, renderbuffer,
/// framebuffer, mpv_render_context, and CADisplayLink. The outer
/// `HybridMpvVideoView` (Nitro HybridView) holds a reference and
/// delegates lifecycle calls.
final class MpvGLView: UIView {

    // ── GL state ────────────────────────────────────────────────────────
    private var eaglContext: EAGLContext?
    private var colorRenderbuffer: GLuint = 0
    private var framebuffer: GLuint = 0
    private var backingWidth: GLint = 0
    private var backingHeight: GLint = 0

    // ── mpv render context ──────────────────────────────────────────────
    private var renderCtx: OpaquePointer?  // mpv_render_context*
    private var mpvHandle: OpaquePointer?  // reference to the player's mpv_handle
    private weak var attachedPlayer: HybridNativeMpv?

    // ── Display link ────────────────────────────────────────────────────
    private var displayLink: CADisplayLink?
    // Atomic flag — set from mpv's update callback thread, read from
    // the main thread's CADisplayLink. Using os_unfair_lock for
    // thread-safe access (plain Bool was a data race that could
    // cause the render loop to stall after minutes of playback).
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

    // ── Layer ───────────────────────────────────────────────────────────
    override class var layerClass: AnyClass { CAEAGLLayer.self }

    private var eaglLayer: CAEAGLLayer { return layer as! CAEAGLLayer }

    // ── Background tracking ─────────────────────────────────────────────
    // Mirrors `UIApplication.applicationState == .background` but read
    // from the hot render path — avoids a `UIApplication.shared` hop
    // on every frame.
    private var isAppInBackground: Bool = false

    // ── Picture-in-Picture ──────────────────────────────────────────────
    // iOS 15+ custom-video-source PiP. We run a second render path
    // into a CVPixelBuffer-backed texture whenever PiP is active, wrap
    // it as a CMSampleBuffer, and enqueue to a sibling
    // AVSampleBufferDisplayLayer that AVPictureInPictureController
    // observes.
    private var pipSampleBufferLayer: AVSampleBufferDisplayLayer?
    private var pipController: AVPictureInPictureController?
    private var pipPixelBufferPool: CVPixelBufferPool?
    private var pipTextureCache: CVOpenGLESTextureCache?
    private var pipFramebuffer: GLuint = 0
    // Dimensions of the buffers currently in the pool. We tear down
    // + rebuild when mpv's `dwidth` / `dheight` changes significantly
    // (e.g. resolution switch).
    private var pipPoolWidth: Int = 0
    private var pipPoolHeight: Int = 0
    private var pipActive: Bool = false

    // MARK: Init

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupLayer()
        registerLifecycleObservers()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupLayer()
        registerLifecycleObservers()
    }

    /// When the app enters background, iOS blocks GPU submissions
    /// (`kIOGPUCommandBufferCallbackErrorBackgroundExecutionNotPermitted`)
    /// — a running CADisplayLink floods the log and stalls the system
    /// MediaPlayer UI. Pausing the link lets mpv continue decoding
    /// audio while stopping all GL work until we're foreground again.
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
        // Keep the display link alive if PiP is active — we need to
        // keep feeding frames to the sample-buffer layer even while
        // the app is backgrounded. `renderFrame` itself skips the
        // CAEAGLLayer submission whenever `isAppInBackground` is set,
        // so there's no risk of a GPU-background error.
        if !pipActive {
            displayLink?.isPaused = true
        }
    }

    @objc private func handleWillEnterForeground() {
        isAppInBackground = false
        displayLink?.isPaused = false
        needsRender = true
    }

    private func setupLayer() {
        eaglLayer.isOpaque = true
        eaglLayer.drawableProperties = [
            kEAGLDrawablePropertyRetainedBacking: false,
            kEAGLDrawablePropertyColorFormat: kEAGLColorFormatRGBA8,
        ]
        // Scale for Retina / ProMotion
        contentScaleFactor = UIScreen.main.scale
        backgroundColor = .black
    }

    // MARK: Layout

    override func layoutSubviews() {
        super.layoutSubviews()
        // The PiP sample-buffer layer is a sibling of the CAEAGLLayer
        // and must stay covered by it (so users don't see the PiP
        // readback behind the main video). Keep the frames in sync.
        pipSampleBufferLayer?.frame = bounds
        guard eaglContext != nil else { return }
        // Rebuild renderbuffer when size changes
        setupRenderbuffer()
        // Render immediately with new size
        needsRender = true
    }

    // MARK: Attach / Detach

    /// Connect to an mpv player instance and start rendering video.
    func attach(player: HybridNativeMpv, mpvHandle handle: OpaquePointer) {
        guard renderCtx == nil else { return }  // already attached
        mpvHandle = handle
        attachedPlayer = player
        player.registerView(self)

        // 1. Create EAGLContext (OpenGL ES 3.0, fallback to 2.0)
        if let ctx = EAGLContext(api: .openGLES3) {
            eaglContext = ctx
        } else if let ctx = EAGLContext(api: .openGLES2) {
            eaglContext = ctx
        } else {
            NSLog("[MpvGLView] Failed to create EAGLContext")
            return
        }
        EAGLContext.setCurrent(eaglContext)

        // 2. Setup renderbuffer + framebuffer
        setupRenderbuffer()

        // 3. Create mpv render context
        guard createRenderContext(mpv: handle) else {
            NSLog("[MpvGLView] Failed to create mpv render context")
            tearDown()
            return
        }

        // 4. Enable video + unpause. mpv was initialized with pause=yes
        // to prevent freezing while vo=libmpv had no render context.
        // Now that the context exists, enable video and unpause.
        mpv_set_property_string(handle, "vid", "auto")
        mpv_set_property_string(handle, "pause", "no")

        // 5. Start CADisplayLink
        startDisplayLink()

        // 6. Arm PiP (iOS only; no-op when the device doesn't
        //    support custom-source PiP). The controller is created
        //    lazily but the sample-buffer layer needs to exist in
        //    the view hierarchy before `startPictureInPicture` is
        //    called, so we set it up eagerly.
        setupPipInfrastructure()
    }

    /// Disconnect from the player. Tears down GL resources.
    func detach() {
        tearDown()
    }

    // MARK: - Private: Render Context

    private func createRenderContext(mpv: OpaquePointer) -> Bool {
        EAGLContext.setCurrent(eaglContext)

        // get_proc_address callback — resolves OpenGL ES function pointers.
        // Matches the Rust `gl_get_proc_address` (mpv_video_gl.rs:424).
        let getProcAddress: @convention(c) (
            UnsafeMutableRawPointer?,
            UnsafePointer<CChar>?
        ) -> UnsafeMutableRawPointer? = { _, name in
            guard let name = name else { return nil }
            // dlsym(RTLD_DEFAULT, name) — same as the Rust reference
            return dlsym(UnsafeMutableRawPointer(bitPattern: -2), name)
        }

        // Build mpv_render_param array
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

        // Set the update callback — signals when mpv has a new frame.
        // We set a flag and let CADisplayLink pick it up on the next
        // vsync (instead of the Rust condvar approach).
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        mpv_render_context_set_update_callback(ctx, { ctx in
            guard let ctx = ctx else { return }
            let view = Unmanaged<MpvGLView>.fromOpaque(ctx).takeUnretainedValue()
            view.needsRender = true
        }, selfPtr)

        return true
    }

    // MARK: - Private: Renderbuffer

    private func setupRenderbuffer() {
        guard let ctx = eaglContext else { return }
        EAGLContext.setCurrent(ctx)

        // Delete old buffers
        if colorRenderbuffer != 0 {
            glDeleteRenderbuffers(1, &colorRenderbuffer)
            colorRenderbuffer = 0
        }
        if framebuffer != 0 {
            glDeleteFramebuffers(1, &framebuffer)
            framebuffer = 0
        }

        // Create renderbuffer from the CAEAGLLayer drawable
        glGenRenderbuffers(1, &colorRenderbuffer)
        glBindRenderbuffer(GLenum(GL_RENDERBUFFER), colorRenderbuffer)
        ctx.renderbufferStorage(Int(GL_RENDERBUFFER), from: eaglLayer)

        glGetRenderbufferParameteriv(
            GLenum(GL_RENDERBUFFER),
            GLenum(GL_RENDERBUFFER_WIDTH),
            &backingWidth
        )
        glGetRenderbufferParameteriv(
            GLenum(GL_RENDERBUFFER),
            GLenum(GL_RENDERBUFFER_HEIGHT),
            &backingHeight
        )

        // Create framebuffer, attach renderbuffer
        glGenFramebuffers(1, &framebuffer)
        glBindFramebuffer(GLenum(GL_FRAMEBUFFER), framebuffer)
        glFramebufferRenderbuffer(
            GLenum(GL_FRAMEBUFFER),
            GLenum(GL_COLOR_ATTACHMENT0),
            GLenum(GL_RENDERBUFFER),
            colorRenderbuffer
        )

        let status = glCheckFramebufferStatus(GLenum(GL_FRAMEBUFFER))
        if status != GLenum(GL_FRAMEBUFFER_COMPLETE) {
            NSLog("[MpvGLView] Framebuffer incomplete: 0x%X", status)
        }
    }

    // MARK: - Private: Display Link

    private func startDisplayLink() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(renderFrame))
        // ProMotion 120Hz — guarded by device capability
        if UIScreen.main.maximumFramesPerSecond >= 120 {
            link.preferredFramesPerSecond = 120
        }
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func renderFrame() {
        // Gate ALL work behind needsRender — set by mpv's update
        // callback only when a new frame is ready. For 24fps video
        // this skips ~96 of 120 display link ticks (nearly free).
        guard needsRender, let renderCtx = renderCtx else { return }
        needsRender = false

        let flags = mpv_render_context_update(renderCtx)
        guard flags & UInt64(MPV_RENDER_UPDATE_FRAME.rawValue) != 0 else { return }

        guard let ctx = eaglContext else { return }
        EAGLContext.setCurrent(ctx)

        // On-screen CAEAGLLayer render. Skipped when the app is
        // backgrounded because iOS blocks GPU submissions to
        // presentRenderbuffer; the PiP pipeline below still runs.
        if !isAppInBackground, backingWidth > 0, backingHeight > 0 {
            renderToMainLayer(renderCtx: renderCtx, ctx: ctx)
        }

        // Off-screen pixel-buffer render for PiP. Only active while
        // AVPictureInPictureController is started — steady-state
        // playback pays nothing here.
        if pipActive {
            renderToPipPixelBuffer(renderCtx)
        }
    }

    /// Render the current mpv frame into our CAEAGLLayer-backed
    /// renderbuffer and present. Extracted so `renderFrame` can
    /// conditionally skip it without affecting the PiP render path.
    private func renderToMainLayer(renderCtx: OpaquePointer, ctx: EAGLContext) {
        glBindFramebuffer(GLenum(GL_FRAMEBUFFER), framebuffer)

        var fbo = mpv_opengl_fbo(
            fbo: Int32(framebuffer),
            w: Int32(backingWidth),
            h: Int32(backingHeight),
            internal_format: 0
        )
        var flipY: Int32 = 1  // CAEAGLLayer needs flip

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

        glBindRenderbuffer(GLenum(GL_RENDERBUFFER), colorRenderbuffer)
        ctx.presentRenderbuffer(Int(GL_RENDERBUFFER))
    }

    // MARK: - Private: Teardown

    private func tearDown() {
        // All GL + render context cleanup must happen on the main
        // thread (same thread that created the EAGLContext). Nitro
        // may call detach/deinit from the JS thread → dispatch.
        let work = { [self] in
            // Stop display link
            displayLink?.invalidate()
            displayLink = nil

            // Tear down PiP BEFORE freeing the render context — the
            // pip framebuffer + texture cache reference the same
            // EAGLContext and must be released first so the render
            // context teardown is clean.
            tearDownPipInfrastructure()

            // Free render context BEFORE destroying GL resources
            if let ctx = renderCtx {
                mpv_render_context_set_update_callback(ctx, nil, nil)
                mpv_render_context_free(ctx)
                renderCtx = nil
            }

            // Unregister from the player
            attachedPlayer?.unregisterView(self)
            attachedPlayer = nil
            mpvHandle = nil

            // Clean up GL
            if let ctx = eaglContext {
                EAGLContext.setCurrent(ctx)
                if colorRenderbuffer != 0 {
                    glDeleteRenderbuffers(1, &colorRenderbuffer)
                    colorRenderbuffer = 0
                }
                if framebuffer != 0 {
                    glDeleteFramebuffers(1, &framebuffer)
                    framebuffer = 0
                }
                EAGLContext.setCurrent(nil)
            }
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

    // MARK: - Picture-in-Picture

    /// Create the sibling `AVSampleBufferDisplayLayer`,
    /// `CVOpenGLESTextureCache`, and `AVPictureInPictureController`.
    /// Called from `attach()` after the GL pipeline is up. No-ops
    /// on devices that don't support custom-source PiP (iPhones
    /// before iOS 15, most iPads support it from iOS 9).
    private func setupPipInfrastructure() {
        dispatchPrecondition(condition: .onQueue(.main))
        guard AVPictureInPictureController.isPictureInPictureSupported() else {
            return
        }
        guard #available(iOS 15.0, *) else { return }
        guard pipSampleBufferLayer == nil else { return }

        // The sample-buffer layer must be in a visible window — iOS
        // pulls frames from it via its compositing path. Insert it
        // BEHIND the CAEAGLLayer so the on-screen video comes from
        // the GL render (sharper + cheaper than the readback path).
        // The layer ends up occluded 100% of the time on-screen but
        // stays valid for PiP use.
        let sbLayer = AVSampleBufferDisplayLayer()
        sbLayer.videoGravity = .resizeAspect
        sbLayer.frame = bounds
        layer.insertSublayer(sbLayer, at: 0)
        pipSampleBufferLayer = sbLayer

        // Shared OpenGL ES texture cache — reused across every PiP
        // frame. Requires an EAGLContext.
        guard let eaglContext = eaglContext else { return }
        var textureCache: CVOpenGLESTextureCache?
        let cacheRc = CVOpenGLESTextureCacheCreate(
            kCFAllocatorDefault,
            nil,
            eaglContext,
            nil,
            &textureCache
        )
        if cacheRc != kCVReturnSuccess {
            NSLog("[MpvGLView] CVOpenGLESTextureCacheCreate failed: %d", cacheRc)
            return
        }
        pipTextureCache = textureCache

        // Framebuffer for the PiP pass. The color attachment is set
        // lazily each frame to whichever pooled pixel buffer we're
        // currently rendering into.
        glGenFramebuffers(1, &pipFramebuffer)

        // Build the controller with a sample-buffer content source.
        let contentSource = AVPictureInPictureController.ContentSource(
            sampleBufferDisplayLayer: sbLayer,
            playbackDelegate: self
        )
        let controller = AVPictureInPictureController(contentSource: contentSource)
        controller.delegate = self
        // YouTube-style behaviour: iOS auto-enters PiP when the user
        // backgrounds the app. Requires `picture-in-picture` in the
        // app's `UIBackgroundModes` (see `app.config.ts`) and
        // `UIBackgroundModes: audio` (already set).
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        pipController = controller

        // Arm the dual-render path now so the sample-buffer layer
        // has fresh frames by the time iOS polls it on
        // `applicationWillResignActive`. Without this, auto-PiP has
        // nothing to show and silently falls back to a frozen frame
        // or no-start.
        pipActive = true
    }

    /// Release the PiP sample-buffer layer, controller, texture
    /// cache, framebuffer, and pool. Safe to call from `tearDown`
    /// even when PiP was never started.
    private func tearDownPipInfrastructure() {
        pipActive = false
        if pipFramebuffer != 0 {
            glDeleteFramebuffers(1, &pipFramebuffer)
            pipFramebuffer = 0
        }
        if let cache = pipTextureCache {
            CVOpenGLESTextureCacheFlush(cache, 0)
        }
        pipTextureCache = nil
        pipPixelBufferPool = nil
        pipPoolWidth = 0
        pipPoolHeight = 0
        pipSampleBufferLayer?.flushAndRemoveImage()
        pipSampleBufferLayer?.removeFromSuperlayer()
        pipSampleBufferLayer = nil
        pipController = nil
    }

    /// Create (or recreate) the CVPixelBufferPool for the given
    /// dimensions. Returns true when the pool is ready.
    ///
    /// The pool is BGRA + IOSurface-backed so each pixel buffer
    /// lives in an IOSurface that OpenGL ES can wrap as a texture
    /// with no CPU copy (the "zero-copy" path).
    @discardableResult
    private func ensurePipPool(width: Int, height: Int) -> Bool {
        guard width > 0, height > 0 else { return false }
        if let _ = pipPixelBufferPool,
           pipPoolWidth == width,
           pipPoolHeight == height {
            return true
        }
        // Drop any textures still referencing the old pool, then
        // drop the pool itself.
        if let cache = pipTextureCache {
            CVOpenGLESTextureCacheFlush(cache, 0)
        }
        pipPixelBufferPool = nil

        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            kCVPixelBufferOpenGLESCompatibilityKey as String: true,
        ]
        var pool: CVPixelBufferPool?
        let rc = CVPixelBufferPoolCreate(
            kCFAllocatorDefault,
            nil,
            attrs as CFDictionary,
            &pool
        )
        guard rc == kCVReturnSuccess, let created = pool else {
            NSLog("[MpvGLView] CVPixelBufferPoolCreate failed: %d", rc)
            return false
        }
        pipPixelBufferPool = created
        pipPoolWidth = width
        pipPoolHeight = height
        return true
    }

    /// Read the current video display size from mpv (`dwidth` /
    /// `dheight`). Returns `nil` when mpv hasn't produced a frame
    /// yet — callers should fall back to retrying on the next tick.
    private func readMpvVideoSize() -> (Int, Int)? {
        guard let mpv = mpvHandle else { return nil }
        var w: Int64 = 0
        var h: Int64 = 0
        let wRc = mpv_get_property(mpv, "dwidth", MPV_FORMAT_INT64, &w)
        if wRc < 0 { return nil }
        let hRc = mpv_get_property(mpv, "dheight", MPV_FORMAT_INT64, &h)
        if hRc < 0 { return nil }
        guard w > 0, h > 0 else { return nil }
        return (Int(w), Int(h))
    }

    /// Render the current mpv frame into a pooled CVPixelBuffer,
    /// wrap it as a `CMSampleBuffer`, and enqueue to the
    /// sample-buffer layer. Called from `renderFrame()` only when
    /// `pipActive == true`.
    ///
    /// Zero-copy path: pool → CVPixelBuffer (IOSurface-backed) →
    /// CVOpenGLESTexture → FBO color attachment → mpv renders into
    /// FBO → CMSampleBuffer references the same IOSurface.
    private func renderToPipPixelBuffer(_ renderCtx: OpaquePointer) {
        // Lazy pool resize — mpv's `dwidth` / `dheight` aren't known
        // until the first frame decodes. We also rebuild if the
        // resolution changes mid-stream (e.g. adaptive-bitrate).
        if let (w, h) = readMpvVideoSize() {
            if pipPixelBufferPool == nil || w != pipPoolWidth || h != pipPoolHeight {
                ensurePipPool(width: w, height: h)
            }
        }
        guard let pool = pipPixelBufferPool,
              let cache = pipTextureCache,
              let sbLayer = pipSampleBufferLayer,
              pipPoolWidth > 0, pipPoolHeight > 0 else { return }

        // 1. Acquire a pixel buffer from the pool.
        var pixelBuffer: CVPixelBuffer?
        let poolRc = CVPixelBufferPoolCreatePixelBuffer(
            kCFAllocatorDefault, pool, &pixelBuffer
        )
        guard poolRc == kCVReturnSuccess, let pb = pixelBuffer else { return }

        // 2. Wrap as a GL texture via the texture cache.
        var texture: CVOpenGLESTexture?
        let texRc = CVOpenGLESTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault,
            cache,
            pb,
            nil,
            GLenum(GL_TEXTURE_2D),
            GL_RGBA,
            GLsizei(pipPoolWidth),
            GLsizei(pipPoolHeight),
            GLenum(GL_BGRA),
            GLenum(GL_UNSIGNED_BYTE),
            0,
            &texture
        )
        guard texRc == kCVReturnSuccess, let tex = texture else { return }
        let texTarget = CVOpenGLESTextureGetTarget(tex)
        let texName = CVOpenGLESTextureGetName(tex)

        // 3. Attach the texture to our PiP framebuffer.
        glBindFramebuffer(GLenum(GL_FRAMEBUFFER), pipFramebuffer)
        glBindTexture(texTarget, texName)
        glTexParameteri(texTarget, GLenum(GL_TEXTURE_MIN_FILTER), GL_LINEAR)
        glTexParameteri(texTarget, GLenum(GL_TEXTURE_MAG_FILTER), GL_LINEAR)
        glTexParameteri(texTarget, GLenum(GL_TEXTURE_WRAP_S), GL_CLAMP_TO_EDGE)
        glTexParameteri(texTarget, GLenum(GL_TEXTURE_WRAP_T), GL_CLAMP_TO_EDGE)
        glFramebufferTexture2D(
            GLenum(GL_FRAMEBUFFER),
            GLenum(GL_COLOR_ATTACHMENT0),
            texTarget,
            texName,
            0
        )

        let status = glCheckFramebufferStatus(GLenum(GL_FRAMEBUFFER))
        guard status == GLenum(GL_FRAMEBUFFER_COMPLETE) else {
            NSLog("[MpvGLView] PiP FBO incomplete: 0x%X", status)
            glFramebufferTexture2D(
                GLenum(GL_FRAMEBUFFER),
                GLenum(GL_COLOR_ATTACHMENT0),
                GLenum(GL_TEXTURE_2D), 0, 0
            )
            return
        }

        // 4. Tell mpv to render into the FBO. No Y-flip — the sample
        //    buffer layer expects top-left origin (unlike CAEAGLLayer).
        var fbo = mpv_opengl_fbo(
            fbo: Int32(pipFramebuffer),
            w: Int32(pipPoolWidth),
            h: Int32(pipPoolHeight),
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

        // Detach texture before releasing our local reference, so the
        // FBO doesn't hold on to it.
        glFramebufferTexture2D(
            GLenum(GL_FRAMEBUFFER),
            GLenum(GL_COLOR_ATTACHMENT0),
            GLenum(GL_TEXTURE_2D), 0, 0
        )

        // 5. Wrap as CMSampleBuffer + enqueue.
        guard let sampleBuffer = makeSampleBuffer(from: pb) else { return }
        if #available(iOS 14.0, *), sbLayer.requiresFlushToResumeDecoding {
            sbLayer.flush()
        }
        if sbLayer.isReadyForMoreMediaData {
            sbLayer.enqueue(sampleBuffer)
        }
    }

    /// Wrap a CVPixelBuffer as a CMSampleBuffer with a host-clock
    /// timestamp. iOS only requires monotonically increasing PTSes
    /// for the sample-buffer layer's built-in decoder queue.
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

        // Mark the single sample as "display immediately" so the PiP
        // layer doesn't queue frames waiting for a later PTS. The
        // CFArray returned here contains CFMutableDictionary items
        // that toll-free-bridge to NSMutableDictionary.
        if let sampleBuffer = sb,
           let attachments = CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer, createIfNecessary: true
           ) as NSArray?,
           let dict = attachments.firstObject as? NSMutableDictionary {
            dict[kCMSampleAttachmentKey_DisplayImmediately as String] = true
        }
        return sb
    }

}

// MARK: - AVPictureInPictureControllerDelegate

@available(iOS 15.0, *)
extension MpvGLView: AVPictureInPictureControllerDelegate {
    func pictureInPictureControllerDidStopPictureInPicture(
        _ controller: AVPictureInPictureController
    ) {
        // If the user dismisses PiP while the app is still in the
        // background, re-pause the display link to stop burning GPU.
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
            // Indefinite / live — per Apple sample code, use
            // (-inf, +inf). The PiP overlay hides the scrubber.
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
        // No-op. The pixel-buffer pool tracks mpv's decode size,
        // not iOS's PiP window size — iOS downsamples for us.
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

/// Nitro HybridView that wraps `MpvGLView`. React mounts this as
/// `<MpvVideoView>` and calls `attachPlayer`/`detachPlayer` via
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
        // Nitro calls hybridRef from the JS thread, but GL layer
        // setup (renderbufferStorage:fromDrawable:) must run on main.
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
