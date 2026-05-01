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
        // Diagnostic mitigation for the documented nav-back UAF
        // (`project_rctswiftui_duplicate_class.md`). Zombies caught
        // `_NSZombie_NativeMpv.MpvMetalView` being released by the
        // Fabric wrapper's `_contentView` ivar during cxx_destruct —
        // i.e. metalView is being over-released by ONE retain, but the
        // retain math (Swift `let metalView`, wrapper `_contentView`,
        // destroyCb retainer, HybridNativeMpv.attachedViews) balances
        // out by inspection. Until the missing release path is
        // identified, hold one extra +1 retain that we deliberately
        // never balance — neutralises the imbalance, prevents UAF.
        // Cost: one MpvMetalView + its IOSurface ring leaks per
        // mounted video session for app lifetime.
        _ = Unmanaged.passRetained(metalView)
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
