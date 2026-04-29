//
//  MpvRenderContext.swift
//  @jellyfuse/native-mpv — Phase 1 render rewrite
//
//  Wraps `mpv_render_context_create` with the fork's
//  `MPV_RENDER_API_TYPE_VK` backend. The init params are populated
//  from `MpvVulkanBridge`; the per-frame target image is supplied by
//  `MpvMetalView`'s ring. Owns the C update callback that fans out to
//  the view's `markNeedsRender`.
//
//  See `~/projects/mpv-apple/include/mpv/render_vk.h` for the
//  contract — get_proc_address must resolve Vulkan entry points,
//  vk_instance/vk_physical_device/vk_device must all be supplied
//  (libplacebo `pl_vulkan_import` requires them).
//

import Foundation
import Libmpv
import Vulkan

enum MpvRenderContextError: Error, CustomStringConvertible {
    case createFailed(Int32)
    case renderFailed(Int32)

    var description: String {
        switch self {
        case .createFailed(let rc):
            return "mpv_render_context_create failed: \(rc)"
        case .renderFailed(let rc):
            return "mpv_render_context_render failed: \(rc)"
        }
    }
}

final class MpvRenderContext {

    let handle: OpaquePointer
    private let bridge: MpvVulkanBridge
    private let updateNotify: () -> Void

    init(
        mpv: OpaquePointer,
        bridge: MpvVulkanBridge,
        debug: Bool = false,
        updateNotify: @escaping () -> Void
    ) throws {
        self.bridge = bridge
        self.updateNotify = updateNotify

        var initParams = bridge.makeInitParams(debug: debug)

        // We pass MPV_RENDER_PARAM_ADVANCED_CONTROL = 1 so mpv lets us
        // drive the render thread ourselves (decoder direct rendering
        // + correct timing). The render-API contract requires that
        // the update callback never blocks the core thread — our
        // implementation only flips an atomic.
        let apiType = strdup(MPV_RENDER_API_TYPE_VK)!
        defer { free(apiType) }
        var advanced: Int32 = 1

        var ctx: OpaquePointer?
        let rc = withUnsafeMutablePointer(to: &initParams) { initPtr -> Int32 in
            return withUnsafeMutablePointer(to: &advanced) { advancedPtr -> Int32 in
                var params: [mpv_render_param] = [
                    mpv_render_param(
                        type: MPV_RENDER_PARAM_API_TYPE,
                        data: UnsafeMutableRawPointer(apiType)
                    ),
                    mpv_render_param(
                        type: MPV_RENDER_PARAM_VULKAN_INIT_PARAMS,
                        data: UnsafeMutableRawPointer(initPtr)
                    ),
                    mpv_render_param(
                        type: MPV_RENDER_PARAM_ADVANCED_CONTROL,
                        data: UnsafeMutableRawPointer(advancedPtr)
                    ),
                    mpv_render_param(
                        type: mpv_render_param_type(rawValue: 0), data: nil
                    ),
                ]
                return mpv_render_context_create(&ctx, mpv, &params)
            }
        }
        guard rc >= 0, let ctx = ctx else {
            throw MpvRenderContextError.createFailed(rc)
        }
        self.handle = ctx

        // Keep a self-pointer for the C update callback. The callback
        // fires off-thread; bouncing through a Swift closure keeps
        // the bridge testable without forcing every consumer to deal
        // with C types.
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        mpv_render_context_set_update_callback(ctx, { ctx in
            guard let ctx = ctx else { return }
            let renderCtx = Unmanaged<MpvRenderContext>
                .fromOpaque(ctx).takeUnretainedValue()
            renderCtx.updateNotify()
        }, selfPtr)
    }

    deinit {
        mpv_render_context_set_update_callback(handle, nil, nil)
        mpv_render_context_free(handle)
    }

    /// Render one frame into the supplied IOSurface-backed VkImage.
    /// Blocks until libmpv_vk's `done_frame` calls `pl_gpu_finish`,
    /// so the IOSurface contents are valid when this returns.
    func render(
        targetImage: VkImage,
        width: UInt32,
        height: UInt32,
        format: VkFormat
    ) throws {
        var target = mpv_vulkan_target_image(
            image: targetImage,
            format: format,
            width: width,
            height: height,
            // The IOSurface-backed VkImage is created with
            // VK_IMAGE_LAYOUT_UNDEFINED. mpv-apple's libmpv_vk uses
            // pl_vulkan_wrap which transitions internally; on entry
            // we tell mpv "the image is in UNDEFINED" and let it
            // transition to COLOR_ATTACHMENT_OPTIMAL on the way out.
            layout: VK_IMAGE_LAYOUT_UNDEFINED,
            final_layout: VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL
        )

        let rc = withUnsafeMutablePointer(to: &target) { targetPtr -> Int32 in
            var params: [mpv_render_param] = [
                mpv_render_param(
                    type: MPV_RENDER_PARAM_VULKAN_TARGET_IMAGE,
                    data: UnsafeMutableRawPointer(targetPtr)
                ),
                mpv_render_param(
                    type: mpv_render_param_type(rawValue: 0), data: nil
                ),
            ]
            return mpv_render_context_render(handle, &params)
        }
        if rc < 0 {
            throw MpvRenderContextError.renderFailed(rc)
        }
    }
}
