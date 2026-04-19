//
//  NativeVideoToolboxSource.swift
//  @jellyfuse/native-mpv — Phase 2c decoder
//
//  VideoSource that runs a parallel libavformat + VideoToolbox pipeline
//  against the same stream URL mpv is playing. Frames come out of the
//  existing `jf_video_*` C bridge already decoded as CVPixelBuffers
//  (nv12 for 8-bit, p010 for 10-bit), then go through a presentation
//  gate synced to mpv's `audio-pts` and are enqueued on the host view's
//  AVSampleBufferDisplayLayer.
//
//  Why parallel, not replacing mpv: mpv keeps handling audio, subtitle
//  decoding, property observers, track-list, now-playing, PiP timebase.
//  Only the video render path flips over. The VideoToolbox output is
//  zero-copy all the way to iOS compositing — no OpenGL intermediate,
//  so 10-bit HDR and (later) Dolby Vision go through without readback.
//
//  Threading (see docs/native-video-pipeline-phase-2.md §7.4):
//    - `jf.native-video.decode`  — this file: pull from jf_video_decode_next
//      → apply gate → enqueue on the display layer. One thread.
//    - The underlying C pump thread lives inside `jf_video_ctx` and
//      handles av_read_frame + VT submit.
//

import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import QuartzCore

final class NativeVideoToolboxSource: VideoSource {

    // ── Attach-time state ──────────────────────────────────────────────
    private weak var targetLayer: AVSampleBufferDisplayLayer?
    private weak var attachedPlayer: HybridNativeMpv?
    private var mpvHandle: OpaquePointer?

    // ── libavformat + VT context ───────────────────────────────────────
    private var videoCtx: OpaquePointer?

    // ── Decode thread ──────────────────────────────────────────────────
    private var decodeThread: Thread?
    private var stopFlag = atomicFlag()
    private var isBackgroundPaused = atomicFlag()

    // ── Presentation gate tuning (see §6.2) ────────────────────────────
    /// Frame is on-time or up to this far ahead of audio → present.
    private let leadBudgetSeconds: Double = 0.033  // one frame @ 30 fps
    /// Frame is this far ahead → hold (gate will resleep).
    private let dropBudgetSeconds: Double = 0.100
    /// Frame is more than this far behind audio → drop.
    private let latePresentLimitSeconds: Double = 0.050

    // MARK: - VideoSource

    func attach(
        to layer: AVSampleBufferDisplayLayer,
        player: HybridNativeMpv,
        mpvHandle handle: OpaquePointer
    ) {
        guard videoCtx == nil else { return }
        targetLayer = layer
        attachedPlayer = player
        mpvHandle = handle

        guard let url = player.nativeStreamUrl else {
            NSLog("[NativeVideoSource] attach failed — no stream URL on player")
            return
        }
        let userAgent = player.nativeUserAgent
        let startSeconds = max(0, player.currentPlaybackSeconds)

        // Open the sidecar decode context. This blocks on the HTTP
        // open + first packet read + VT session creation — run on a
        // background queue so we don't stall the attach call site.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            let ctx: OpaquePointer? = url.withCString { urlPtr in
                if let ua = userAgent {
                    return ua.withCString { uaPtr in
                        jf_video_open(urlPtr, startSeconds, uaPtr)
                    }
                }
                return jf_video_open(urlPtr, startSeconds, nil)
            }
            guard let ctx else {
                NSLog("[NativeVideoSource] jf_video_open failed")
                return
            }
            if self.stopFlag.load() {
                jf_video_close(ctx)
                return
            }
            self.videoCtx = ctx

            // mpv initialised with vid=no + pause=yes. Keep vid=no (the
            // native decoder is rendering video now) and unpause audio
            // so the master clock starts advancing.
            mpv_set_property_string(handle, "pause", "no")

            self.startDecodeThread()
        }
    }

    func detach() {
        tearDown()
    }

    func applicationBackgroundDidChange(isBackground: Bool, pipKeepingLayerLive: Bool) {
        isBackgroundPaused.store(isBackground && !pipKeepingLayerLive)
    }

    // MARK: - Decode thread

    private func startDecodeThread() {
        guard decodeThread == nil else { return }
        let thread = Thread { [weak self] in self?.decodeLoop() }
        thread.name = "jf.native-video.decode"
        thread.qualityOfService = .userInitiated
        decodeThread = thread
        thread.start()
    }

    private func decodeLoop() {
        var outPtr: UnsafeMutableRawPointer?
        var ptsSeconds: Double = 0
        var isKeyframe: Int32 = 0
        var bootstrapEnqueued = false

        while !stopFlag.load() {
            // If the app is backgrounded without PiP, stop pulling
            // frames — iOS won't composite them and the layer's decode
            // queue would just grow.
            if isBackgroundPaused.load() {
                Thread.sleep(forTimeInterval: 0.1)
                continue
            }

            guard let ctx = videoCtx else { break }

            outPtr = nil
            ptsSeconds = 0
            isKeyframe = 0
            let rc = jf_video_decode_next(ctx, 0.1, &outPtr, &ptsSeconds, &isKeyframe)
            if rc == -1 { break }  // stopped
            if rc == -2 { continue }  // timeout → poll again
            if rc == 1 && outPtr == nil { break }  // EOF
            guard rc == 0, let pbPtr = outPtr else { continue }

            // `jf_video_decode_next` hands us a retained CVPixelBuffer.
            let pixelBuffer = Unmanaged<CVPixelBuffer>
                .fromOpaque(pbPtr).takeRetainedValue()

            // ── Presentation gate ───────────────────────────────────
            // Use mpv's audio-pts as the master clock. While we're
            // bootstrapping (no audio-pts yet, or it's still advancing
            // from 0 while the HLS manifest primes), fall through and
            // enqueue so the first frame paints immediately.
            let audioPts = attachedPlayer?.audioPtsSeconds ?? 0
            if audioPts > 0 {
                bootstrapEnqueued = true
                let delta = ptsSeconds - audioPts
                if delta < -latePresentLimitSeconds {
                    // Frame is 50+ ms behind audio — drop. Usually
                    // transient, right after a seek while VT is
                    // catching up.
                    continue
                }
                // If we're ahead by more than the drop budget, sleep
                // until we're back in the lead window. Poll in small
                // increments so cancel / background transitions see
                // the stop flag quickly.
                while !stopFlag.load() {
                    let currentAudio = attachedPlayer?.audioPtsSeconds ?? 0
                    let slack = ptsSeconds - currentAudio
                    if slack <= leadBudgetSeconds { break }
                    let sleep = min(max(slack - leadBudgetSeconds, 0.005), 0.05)
                    Thread.sleep(forTimeInterval: sleep)
                }
                if stopFlag.load() { break }
            } else if !bootstrapEnqueued {
                // No audio-pts yet and we haven't painted anything.
                // Push this one frame through so the view isn't black
                // while audio primes; the gate takes over afterwards.
                bootstrapEnqueued = true
            }

            enqueueOnLayer(pixelBuffer: pixelBuffer, ptsSeconds: ptsSeconds)
        }
    }

    // MARK: - Enqueue

    private func enqueueOnLayer(pixelBuffer: CVPixelBuffer, ptsSeconds: Double) {
        // Wrap + enqueue on main. The CALayer tree is touched by the
        // compositor there and DisplayImmediately means the display
        // layer ignores the timing we stamp — the gate already did
        // the timing work.
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let layer = self.targetLayer else { return }
            guard let sampleBuffer = self.makeSampleBuffer(from: pixelBuffer) else { return }
            if #available(iOS 14.0, *), layer.requiresFlushToResumeDecoding {
                layer.flush()
            }
            if layer.isReadyForMoreMediaData {
                layer.enqueue(sampleBuffer)
            }
            _ = ptsSeconds  // currently unused here; reserved for tracing
        }
    }

    /// Wrap a CVPixelBuffer (straight from VT) as a CMSampleBuffer
    /// stamped with a host-clock PTS. Mirrors the Phase 0 path so the
    /// PiP / control-timebase plumbing in `MpvVideoView` sees the same
    /// timing conventions regardless of which source is active.
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

        if let sampleBuffer = sb,
            let attachments = CMSampleBufferGetSampleAttachmentsArray(
                sampleBuffer, createIfNecessary: true
            ) as NSArray?,
            let dict = attachments.firstObject as? NSMutableDictionary
        {
            dict[kCMSampleAttachmentKey_DisplayImmediately as String] = true
        }
        return sb
    }

    // MARK: - Teardown

    private func tearDown() {
        stopFlag.store(true)

        // Cancel any parked decode call so the thread can exit its
        // `jf_video_decode_next` / blocking HTTP read promptly.
        if let ctx = videoCtx {
            jf_video_cancel(ctx)
        }

        // Join the decode thread off the current thread — if we're on
        // main and the decode thread needs to hop to main for enqueue,
        // waiting synchronously would deadlock. NSThread has no join
        // primitive; busy-wait in small increments with a deadline.
        let thread = decodeThread
        decodeThread = nil
        if let thread = thread {
            let deadline = Date().addingTimeInterval(1.0)
            while !thread.isFinished && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.01)
            }
        }

        if let ctx = videoCtx {
            jf_video_close(ctx)
            videoCtx = nil
        }

        attachedPlayer = nil
        mpvHandle = nil
        targetLayer = nil
    }

    deinit {
        tearDown()
    }
}

// MARK: - Tiny atomic-bool helper

/// `_Atomic(bool)` with a Swift face. Used for the stop / background
/// flags the decode thread polls. `os_unfair_lock`-wrapped Bool is
/// overkill; this maps directly to `std::atomic<bool>` semantics via
/// `OSAtomicCompareAndSwap32`-style implicit ordering.
private struct atomicFlag {
    private var value: Int32 = 0

    mutating func load() -> Bool {
        return withUnsafePointer(to: &value) { ptr -> Bool in
            return OSAtomicAdd32(0, UnsafeMutablePointer(mutating: ptr)) != 0
        }
    }

    mutating func store(_ newValue: Bool) {
        withUnsafeMutablePointer(to: &value) { ptr in
            OSAtomicCompareAndSwap32(ptr.pointee, newValue ? 1 : 0, ptr)
        }
    }
}
