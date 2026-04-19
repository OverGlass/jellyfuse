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

    // ── Color / HDR metadata (cached once per stream) ──────────────────
    /// Populated on first successful `jf_video_open`. The attachments
    /// are stream-global — they don't change mid-playback barring
    /// color-space hotswap (rare; §10.2 in the plan doc).
    private var cachedColorAttachments: [CFString: CFTypeRef]?
    /// Raw bytes for the HDR10 mastering display color volume and
    /// content-light-level attachments. Stored as `CFData` because
    /// that's the type AVFoundation expects on the CVPixelBuffer
    /// attachment dictionary.
    private var cachedMasteringCFData: CFData?
    private var cachedCllCFData: CFData?

    // ── Decode thread ──────────────────────────────────────────────────
    private var decodeThread: Thread?
    private var stopFlag = atomicFlag()
    private var isBackgroundPaused = atomicFlag()
    private var isDetached = atomicFlag()

    // Serialises seek work so a teardown that fires mid-seek blocks
    // on any in-flight cancel/join/seek/restart. Also prevents two
    // seek notifications (scrub storms) from racing each other.
    private let seekQueue = DispatchQueue(label: "jf.native-video.seek")

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

            // Pull color + HDR metadata off the stream once. The values
            // are invariant for the session (barring the rare mid-stream
            // color-space change the plan doc calls out), so caching
            // avoids hitting the C bridge on the hot decode path.
            self.cacheStreamMetadata(ctx: ctx)

            // mpv initialised with vid=no + pause=yes. Keep vid=no (the
            // native decoder is rendering video now) and unpause audio
            // so the master clock starts advancing.
            mpv_set_property_string(handle, "pause", "no")

            self.startDecodeThread()
        }
    }

    func detach() {
        isDetached.store(true)
        // Wait for any in-flight seek before ripping the context out
        // from under it — otherwise `jf_video_seek` could race with
        // `jf_video_close`.
        seekQueue.sync {}
        tearDown()
    }

    func seek(to seconds: Double) {
        if isDetached.load() { return }
        seekQueue.async { [weak self] in
            guard let self = self else { return }
            if self.isDetached.load() { return }
            self.performSeek(to: seconds)
        }
    }

    /// Cancel the decode thread, clear the display layer, reposition
    /// the demuxer + decoder, and spin up a fresh decode thread. Runs
    /// on `seekQueue` so multiple seek notifications serialise.
    private func performSeek(to seconds: Double) {
        guard let ctx = videoCtx else { return }

        // 1. Stop the decode thread — flag + cancel the blocking
        //    HTTP / av_read_frame call so `jf_video_decode_next`
        //    returns promptly.
        stopFlag.store(true)
        jf_video_cancel(ctx)

        let thread = decodeThread
        decodeThread = nil
        if let thread = thread {
            let deadline = Date().addingTimeInterval(1.0)
            while !thread.isFinished && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.01)
            }
        }

        if isDetached.load() { return }

        // 2. Clear the stale frame that was on screen before seek —
        //    otherwise the scrubber has already moved but the frame
        //    sticks until the first post-seek frame arrives.
        DispatchQueue.main.async { [weak self] in
            self?.targetLayer?.flushAndRemoveImage()
        }

        // 3. Reposition demuxer + decoder. `jf_video_seek` flushes
        //    VT internally and reissues parameter sets.
        _ = jf_video_seek(ctx, seconds)

        if isDetached.load() { return }

        // 4. Restart the decode thread. `stopFlag` must go back to
        //    false *before* spawning — the new thread reads it from
        //    its first loop iteration.
        stopFlag.store(false)
        startDecodeThread()
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
            applyColorAttachments(to: pixelBuffer)

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

    // MARK: - Color / HDR tagging

    /// Read color primaries / transfer / matrix + HDR10 mastering + CLL
    /// off the ctx and pre-build the CF objects we'll stamp onto each
    /// pixel buffer. Called once right after `jf_video_open` succeeds.
    private func cacheStreamMetadata(ctx: OpaquePointer) {
        var pri: Int32 = 0
        var trc: Int32 = 0
        var mat: Int32 = 0
        var rng: Int32 = 0
        jf_video_color_info(ctx, &pri, &trc, &mat, &rng)

        var attachments: [CFString: CFTypeRef] = [:]
        if let key = cvColorPrimariesKey(forAVColorPrimaries: pri) {
            attachments[kCVImageBufferColorPrimariesKey] = key
        }
        if let key = cvTransferFunctionKey(forAVTransfer: trc) {
            attachments[kCVImageBufferTransferFunctionKey] = key
        }
        if let key = cvYCbCrMatrixKey(forAVColorSpace: mat) {
            attachments[kCVImageBufferYCbCrMatrixKey] = key
        }
        cachedColorAttachments = attachments.isEmpty ? nil : attachments

        // HDR10 static mastering display color volume. FFmpeg hands us
        // chromaticities in 1/50000 fixed-point and luminances in
        // 1/10000 fixed-point — the exact units AVFoundation expects
        // in the 24-byte big-endian blob for
        // kCVImageBufferMasteringDisplayColorVolumeKey.
        var mastering = [UInt32](repeating: 0, count: 10)
        let hasMastering =
            mastering.withUnsafeMutableBufferPointer { buf -> Int32 in
                guard let base = buf.baseAddress else { return 0 }
                return jf_video_hdr_mastering(ctx, base)
            }
        if hasMastering == 1 {
            cachedMasteringCFData = packMasteringDisplayVolume(mastering)
        }

        var cll = [UInt16](repeating: 0, count: 2)
        let hasCll = cll.withUnsafeMutableBufferPointer { buf -> Int32 in
            guard let base = buf.baseAddress else { return 0 }
            return jf_video_hdr_cll(ctx, base)
        }
        if hasCll == 1 {
            cachedCllCFData = packContentLightLevel(cll)
        }

        if let attachments = cachedColorAttachments, !attachments.isEmpty {
            let pri = attachments[kCVImageBufferColorPrimariesKey] as? String ?? "-"
            let trc = attachments[kCVImageBufferTransferFunctionKey] as? String ?? "-"
            let mat = attachments[kCVImageBufferYCbCrMatrixKey] as? String ?? "-"
            NSLog(
                "[NativeVideoSource] color primaries=%@ transfer=%@ matrix=%@ hdr=%@",
                pri, trc, mat,
                (cachedMasteringCFData != nil || cachedCllCFData != nil) ? "yes" : "no"
            )
        }
    }

    /// Stamp the cached color + HDR attachments on a decoded frame.
    /// iOS's compositor falls back to Rec.709 when these are missing,
    /// which crushes HDR blacks and shifts Rec.2020 primaries toward
    /// sRGB.
    private func applyColorAttachments(to pixelBuffer: CVPixelBuffer) {
        if let attachments = cachedColorAttachments {
            for (key, value) in attachments {
                CVBufferSetAttachment(pixelBuffer, key, value, .shouldPropagate)
            }
        }
        if let mastering = cachedMasteringCFData {
            CVBufferSetAttachment(
                pixelBuffer,
                kCVImageBufferMasteringDisplayColorVolumeKey,
                mastering,
                .shouldPropagate
            )
        }
        if let cll = cachedCllCFData {
            CVBufferSetAttachment(
                pixelBuffer,
                kCVImageBufferContentLightLevelInfoKey,
                cll,
                .shouldPropagate
            )
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

        cachedColorAttachments = nil
        cachedMasteringCFData = nil
        cachedCllCFData = nil

        attachedPlayer = nil
        mpvHandle = nil
        targetLayer = nil
    }

    deinit {
        tearDown()
    }
}

// MARK: - FFmpeg → CoreVideo color mapping
//
// FFmpeg hands us `AVColorPrimaries` / `AVColorTransferCharacteristic` /
// `AVColorSpace` enum values straight off the codec context. CoreVideo
// expects CFString keys on the pixel-buffer attachments. The three
// helpers below map the enums we actually see in Jellyfin libraries —
// everything else is left untagged so iOS's default (Rec.709) applies.
//
// FFmpeg enum numeric values are ABI-stable; raw ints are cheaper than
// pulling in the `@_silgen_name` symbol table.

private func cvColorPrimariesKey(forAVColorPrimaries value: Int32) -> CFString? {
    // AVCOL_PRI_BT709 = 1, BT2020 = 9, SMPTE432 (P3 D65) = 12.
    switch value {
    case 1: return kCVImageBufferColorPrimaries_ITU_R_709_2
    case 9: return kCVImageBufferColorPrimaries_ITU_R_2020
    case 12: return kCVImageBufferColorPrimaries_P3_D65
    default: return nil
    }
}

private func cvTransferFunctionKey(forAVTransfer value: Int32) -> CFString? {
    // AVCOL_TRC_BT709 = 1, SMPTE2084 (PQ) = 16, ARIB_STD_B67 (HLG) = 18.
    switch value {
    case 1: return kCVImageBufferTransferFunction_ITU_R_709_2
    case 16: return kCVImageBufferTransferFunction_SMPTE_ST_2084_PQ
    case 18: return kCVImageBufferTransferFunction_ITU_R_2100_HLG
    default: return nil
    }
}

private func cvYCbCrMatrixKey(forAVColorSpace value: Int32) -> CFString? {
    // AVCOL_SPC_BT709 = 1, SMPTE170M = 6 (BT.601), BT2020_NCL = 9.
    switch value {
    case 1: return kCVImageBufferYCbCrMatrix_ITU_R_709_2
    case 6: return kCVImageBufferYCbCrMatrix_ITU_R_601_4
    case 9: return kCVImageBufferYCbCrMatrix_ITU_R_2020
    default: return nil
    }
}

// MARK: - HDR10 static metadata packing
//
// CoreVideo's `kCVImageBufferMasteringDisplayColorVolumeKey` takes a
// 24-byte big-endian blob (SMPTE ST 2086). The FFmpeg fixed-point
// layout matches exactly — chromaticities in 1/50000 and luminance in
// 1/10000 cd/m² — so packing is just a memcpy with byte swaps.
//
// Layout: Rx Ry Gx Gy Bx By WPx WPy (u16 each) + max_luma, min_luma (u32 each).

private func packMasteringDisplayVolume(_ mastering: [UInt32]) -> CFData? {
    guard mastering.count == 10 else { return nil }
    var bytes = [UInt8](repeating: 0, count: 24)
    // 8 × u16 chromaticities (RGB primaries + white point).
    for i in 0..<8 {
        let v = UInt16(clamping: mastering[i])
        bytes[i * 2] = UInt8((v >> 8) & 0xff)
        bytes[i * 2 + 1] = UInt8(v & 0xff)
    }
    // 2 × u32 luminance.
    for i in 0..<2 {
        let v = mastering[8 + i]
        let off = 16 + i * 4
        bytes[off] = UInt8((v >> 24) & 0xff)
        bytes[off + 1] = UInt8((v >> 16) & 0xff)
        bytes[off + 2] = UInt8((v >> 8) & 0xff)
        bytes[off + 3] = UInt8(v & 0xff)
    }
    return bytes.withUnsafeBufferPointer { buf -> CFData? in
        guard let base = buf.baseAddress else { return nil }
        return CFDataCreate(kCFAllocatorDefault, base, 24)
    }
}

/// Content-light-level info — 4 bytes, big-endian: MaxCLL (u16),
/// MaxFALL (u16). cd/m², zero = unknown.
private func packContentLightLevel(_ cll: [UInt16]) -> CFData? {
    guard cll.count == 2 else { return nil }
    let bytes: [UInt8] = [
        UInt8((cll[0] >> 8) & 0xff),
        UInt8(cll[0] & 0xff),
        UInt8((cll[1] >> 8) & 0xff),
        UInt8(cll[1] & 0xff),
    ]
    return bytes.withUnsafeBufferPointer { buf -> CFData? in
        guard let base = buf.baseAddress else { return nil }
        return CFDataCreate(kCFAllocatorDefault, base, 4)
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
