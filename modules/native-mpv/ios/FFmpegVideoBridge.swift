//
//  FFmpegVideoBridge.swift
//  @jellyfuse/native-mpv — Swift bindings for the libavformat + VideoToolbox
//  video decode pipeline exposed as plain-C symbols from FFmpegBridge.mm.
//
//  Shared by:
//    - `HybridNativeMpv` (Phase 2a diagnostic harness — logs the open
//      summary, codec, color info, HDR metadata)
//    - `NativeVideoToolboxSource` (Phase 2c decoder — pulls frames for
//      the AVSampleBufferDisplayLayer through the presentation gate)
//
//  Pure-C symbols are picked up via `@_silgen_name`, same pattern as
//  the bitmap-sub bridge. Declarations are `internal` so both consumers
//  in this module can reach them without a bridging header.
//

import Foundation

@_silgen_name("jf_video_open")
func jf_video_open(
    _ url: UnsafePointer<CChar>?,
    _ startSeconds: Double,
    _ userAgent: UnsafePointer<CChar>?,
) -> OpaquePointer?

@_silgen_name("jf_video_close")
func jf_video_close(_ ctx: OpaquePointer?)

@_silgen_name("jf_video_cancel")
func jf_video_cancel(_ ctx: OpaquePointer?)

@_silgen_name("jf_video_codec_id")
func jf_video_codec_id(_ ctx: OpaquePointer?) -> Int32

@_silgen_name("jf_video_bits_per_sample")
func jf_video_bits_per_sample(_ ctx: OpaquePointer?) -> Int32

@_silgen_name("jf_video_dimensions")
func jf_video_dimensions(
    _ ctx: OpaquePointer?,
    _ outWidth: UnsafeMutablePointer<Int32>,
    _ outHeight: UnsafeMutablePointer<Int32>,
)

@_silgen_name("jf_video_color_info")
func jf_video_color_info(
    _ ctx: OpaquePointer?,
    _ outPrimaries: UnsafeMutablePointer<Int32>,
    _ outTransfer: UnsafeMutablePointer<Int32>,
    _ outMatrix: UnsafeMutablePointer<Int32>,
    _ outRange: UnsafeMutablePointer<Int32>,
)

@_silgen_name("jf_video_hdr_mastering")
func jf_video_hdr_mastering(
    _ ctx: OpaquePointer?,
    _ mastering: UnsafeMutablePointer<UInt32>,
) -> Int32

@_silgen_name("jf_video_hdr_cll")
func jf_video_hdr_cll(
    _ ctx: OpaquePointer?,
    _ cll: UnsafeMutablePointer<UInt16>,
) -> Int32

@_silgen_name("jf_video_dolby_vision_profile")
func jf_video_dolby_vision_profile(_ ctx: OpaquePointer?) -> Int32

@_silgen_name("jf_video_decode_next")
func jf_video_decode_next(
    _ ctx: OpaquePointer?,
    _ timeoutSeconds: Double,
    _ outPixelBuffer: UnsafeMutablePointer<UnsafeMutableRawPointer?>,
    _ outPtsSeconds: UnsafeMutablePointer<Double>,
    _ outIsKeyframe: UnsafeMutablePointer<Int32>,
) -> Int32

@_silgen_name("jf_video_seek")
func jf_video_seek(_ ctx: OpaquePointer?, _ seconds: Double) -> Int32

@_silgen_name("jf_video_format_description")
func jf_video_format_description(_ ctx: OpaquePointer?) -> UnsafeMutableRawPointer?

@_silgen_name("jf_video_pixel_format")
func jf_video_pixel_format(_ ctx: OpaquePointer?) -> UInt32
