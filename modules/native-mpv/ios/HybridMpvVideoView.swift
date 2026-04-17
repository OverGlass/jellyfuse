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

    // MARK: Init

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupLayer()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupLayer()
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

        guard backingWidth > 0, backingHeight > 0 else { return }

        // Bind our framebuffer
        glBindFramebuffer(GLenum(GL_FRAMEBUFFER), framebuffer)

        // Tell mpv to render into our FBO — matches Rust mpv_video_gl.rs:760-779
        var fbo = mpv_opengl_fbo(
            fbo: Int32(framebuffer),
            w: Int32(backingWidth),
            h: Int32(backingHeight),
            internal_format: 0
        )
        var flipY: Int32 = 1  // CAEAGLLayer needs flip (unlike CVPixelBuffer in Rust)

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

        // Present the renderbuffer
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
        tearDown()
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
