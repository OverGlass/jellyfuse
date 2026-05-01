//
//  MpvSampleBufferEnqueuer.swift
//  @jellyfuse/native-mpv — Phase 1 render rewrite
//
//  Wraps an IOSurface-backed CVPixelBuffer (libmpv just rendered
//  into it via Vulkan) as a CMSampleBuffer with a host-clock PTS,
//  and enqueues into the AVSampleBufferDisplayLayer that backs both
//  the on-screen view and the PiP floating window.
//
//  PTS strategy mirrors the GLES-era code: stamp with
//  `CMClockGetHostTimeClock` + `DisplayImmediately`. iOS composites
//  without queueing on timing, but the layer's `controlTimebase`
//  (advanced from `applyPlaybackState`) drives the PiP scrubber +
//  skip-forward gating. Phase 3 will revisit for HDR — color
//  attachments and the `EDRMetadata` path land then.
//

import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import UIKit

final class MpvSampleBufferEnqueuer {

    private weak var layer: AVSampleBufferDisplayLayer?
    private var formatDescription: CMFormatDescription?
    private var lastDimensions: CMVideoDimensions?

    init(layer: AVSampleBufferDisplayLayer) {
        self.layer = layer
    }

    func enqueue(pixelBuffer: CVPixelBuffer) {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let layer = layer else { return }

        // Rebuild the format description on first use and on any
        // resolution change. CMSampleBuffer creation rejects a stale
        // formatDescription that disagrees with the image buffer.
        let dims = CMVideoDimensions(
            width: Int32(CVPixelBufferGetWidth(pixelBuffer)),
            height: Int32(CVPixelBufferGetHeight(pixelBuffer))
        )
        if formatDescription == nil
            || lastDimensions?.width != dims.width
            || lastDimensions?.height != dims.height
        {
            // Phase 3 step 3+4: explicit BT.2020 / SMPTE_ST_2084 (PQ)
            // extensions on the format description. The CVPixelBuffer
            // already carries these attachments via `.shouldPropagate`
            // (set in MpvMetalView.buildRing), but
            // `CMVideoFormatDescriptionCreateForImageBuffer`'s
            // auto-derivation is incomplete on some iOS versions for
            // 16-bit float RGBA buffers — explicit extensions ensure
            // AVSBDL recognises the layer as HDR10 PQ and engages EDR
            // composition.
            let extensions: [CFString: Any] = [
                kCMFormatDescriptionExtension_ColorPrimaries:
                    kCMFormatDescriptionColorPrimaries_ITU_R_2020,
                kCMFormatDescriptionExtension_TransferFunction:
                    kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ,
                kCMFormatDescriptionExtension_YCbCrMatrix:
                    kCMFormatDescriptionYCbCrMatrix_ITU_R_2020,
                kCMFormatDescriptionExtension_FullRangeVideo: true,
            ]
            var fd: CMFormatDescription?
            let rc = CMVideoFormatDescriptionCreateForImageBuffer(
                allocator: kCFAllocatorDefault,
                imageBuffer: pixelBuffer,
                formatDescriptionOut: &fd
            )
            if rc != noErr || fd == nil {
                NSLog(
                    "[MpvSampleBufferEnqueuer] CMVideoFormatDescriptionCreateForImageBuffer failed: %d",
                    rc
                )
                return
            }
            // Re-create with explicit extensions merged in. Apple has no
            // "set extensions" API on CMFormatDescription — we have to
            // build a fresh one with the merged dictionary.
            let codecType = CMFormatDescriptionGetMediaSubType(fd!)
            let merged = (CMFormatDescriptionGetExtensions(fd!) as? [CFString: Any] ?? [:])
                .merging(extensions, uniquingKeysWith: { _, new in new })
            var fd2: CMFormatDescription?
            let rc2 = CMVideoFormatDescriptionCreate(
                allocator: kCFAllocatorDefault,
                codecType: codecType,
                width: dims.width,
                height: dims.height,
                extensions: merged as CFDictionary,
                formatDescriptionOut: &fd2
            )
            if rc2 != noErr || fd2 == nil {
                NSLog(
                    "[MpvSampleBufferEnqueuer] CMVideoFormatDescriptionCreate(merged) failed: %d, falling back",
                    rc2
                )
                formatDescription = fd
            } else {
                formatDescription = fd2
            }
            lastDimensions = dims

            // EDR headroom diagnostic: > 1.0 means the panel has HDR
            // brightness above SDR available right now (depends on
            // ambient light, current brightness setting, content size,
            // OS thermal state). 13 mini in dim room: ~1.5x. Bright
            // room or low display brightness suppresses EDR.
            if #available(iOS 16.0, *) {
                let screen = UIScreen.main
                NSLog(
                    "[MpvSampleBufferEnqueuer] EDR headroom %.2f (potential %.2f)",
                    screen.currentEDRHeadroom,
                    screen.potentialEDRHeadroom
                )
            }
        }
        guard let fd = formatDescription else { return }

        let pts = CMClockGetTime(CMClockGetHostTimeClock())
        var timing = CMSampleTimingInfo(
            duration: .invalid,
            presentationTimeStamp: pts,
            decodeTimeStamp: .invalid
        )

        var sampleBuffer: CMSampleBuffer?
        let rc = CMSampleBufferCreateReadyWithImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            formatDescription: fd,
            sampleTiming: &timing,
            sampleBufferOut: &sampleBuffer
        )
        guard rc == noErr, let sb = sampleBuffer else {
            NSLog("[MpvSampleBufferEnqueuer] CMSampleBufferCreate failed: %d", rc)
            return
        }

        if let attachments = CMSampleBufferGetSampleAttachmentsArray(
            sb, createIfNecessary: true
        ) as NSArray?,
            let dict = attachments.firstObject as? NSMutableDictionary
        {
            dict[kCMSampleAttachmentKey_DisplayImmediately as String] = true
        }

        // iOS 14+: rebuffer after a failed decode (rare in practice
        // for our pre-rendered surfaces but we honor the contract).
        if #available(iOS 14.0, *), layer.requiresFlushToResumeDecoding {
            layer.flush()
        }
        if layer.isReadyForMoreMediaData {
            layer.enqueue(sb)
        }
    }
}
