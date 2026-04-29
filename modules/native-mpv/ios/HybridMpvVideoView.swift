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
        // Nitro hybrid refs are invoked from the JS thread; Vulkan +
        // AVPictureInPictureController setup must run on main.
        DispatchQueue.main.async { [weak self] in
            self?.metalView.attach(player: player, mpvHandle: handle)
        }
    }

    public func detachPlayer() throws {
        metalView.detach()
    }

    public func onDropView() {
        metalView.detach()
    }
}
