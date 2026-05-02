//
//  HybridMpvVideoView.swift
//  @jellyfuse/native-mpv — Phase 1 Metal/Vulkan render
//
//  Nitro HybridView wrapper. Owns the `MpvMetalView` (UIView subclass
//  whose root layer is `AVSampleBufferDisplayLayer`); the actual
//  render plumbing — Vulkan bring-up, IOSurface ring, mpv render
//  context, AVSBDL enqueue, PiP — lives in
//  `ios/render/Mpv{MetalView,VulkanBridge,RenderContext,SampleBufferEnqueuer}.swift`.
//
//  React mounts this as `<MpvVideoView>` and calls
//  `attachPlayer(instanceId)` / `detachPlayer()` via the hybrid ref.
//

import Foundation
import NitroModules
import UIKit

public final class HybridMpvVideoView: HybridMpvVideoViewSpec {

    private let metalView = MpvMetalView()

    public var view: UIView { return metalView }

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
        // Vulkan + AVPictureInPictureController setup must run on main.
        // Block the (JS-thread) caller until the main-thread attach
        // completes — JS code is allowed to call `load()` immediately
        // after attachPlayer, and `vo=gpu-next gpu-context=libmpvvk`
        // requires the consumer pool to be registered before mpv's
        // vo_create runs (which is synchronous inside `loadfile`).
        if Thread.isMainThread {
            metalView.attach(player: player, mpvHandle: handle)
        } else {
            DispatchQueue.main.sync { [weak self] in
                self?.metalView.attach(player: player, mpvHandle: handle)
            }
        }
    }

    public func detachPlayer() throws {
        metalView.detach()
    }

    public func onDropView() {
        metalView.detach()
    }
}
