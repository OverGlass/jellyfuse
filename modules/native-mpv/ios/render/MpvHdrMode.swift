//
//  MpvHdrMode.swift
//  @jellyfuse/native-mpv — Phase 3 (HDR detection)
//
//  Internal HDR-mode signal derived from mpv's `video-params` property.
//  Step 2 of Phase 3 plumbs this from libmpv up to MpvMetalView so step 3
//  can flip AVSampleBufferDisplayLayer EDR metadata accordingly.
//
//  No JS surface: NativeMpv.nitro.ts is frozen (per the locked plan).
//

import Foundation
import Libmpv

enum MpvHdrMode: Equatable {
    case sdr
    case hdr10
    case hlg

    /// Map (transfer, primaries) → mode. Anything that isn't unambiguously
    /// PQ/BT.2020 or HLG/BT.2020 falls back to SDR — libplacebo's
    /// `target-trc=auto` will tone-map either way.
    static func classify(transfer: String?, primaries: String?) -> MpvHdrMode {
        guard let transfer = transfer?.lowercased() else { return .sdr }
        let prim = primaries?.lowercased() ?? ""
        if transfer == "pq" || transfer == "smpte2084" {
            return prim == "bt.2020" || prim == "bt2020" ? .hdr10 : .sdr
        }
        if transfer == "hlg" || transfer == "arib-std-b67" {
            return prim == "bt.2020" || prim == "bt2020" ? .hlg : .sdr
        }
        return .sdr
    }
}

/// Walk an `mpv_node` of type MPV_FORMAT_NODE_MAP and read string values for
/// the requested keys. Returns a dictionary keyed by the input names. Any key
/// that isn't present (or isn't a string) is omitted.
func readMpvNodeMapStrings(_ node: mpv_node, keys: Set<String>) -> [String: String] {
    guard node.format == MPV_FORMAT_NODE_MAP, let listPtr = node.u.list else { return [:] }
    let list = listPtr.pointee
    let count = Int(list.num)
    guard count > 0, let valuesPtr = list.values, let keysPtr = list.keys else { return [:] }
    var out: [String: String] = [:]
    for i in 0..<count {
        guard let kPtr = keysPtr[i] else { continue }
        let key = String(cString: kPtr)
        guard keys.contains(key) else { continue }
        let v = valuesPtr[i]
        if v.format == MPV_FORMAT_STRING, let strPtr = v.u.string {
            out[key] = String(cString: strPtr)
        }
    }
    return out
}
