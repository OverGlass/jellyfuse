# Phase 2 — pre-2a spike + verification log

Answers to the §16 spike questions from `docs/native-video-pipeline-phase-2.md`,
plus running verification notes as each sub-phase lands.

---

## Pre-2a spike

### Q1. Does mpv still publish `dwidth` / `dheight` with `video=no`?

**A (from docs):** No — those properties reflect the **currently
displayed** video size. With `video=no` mpv never selects a video
track, so `dwidth` / `dheight` return 0 (or fail the get).

**Implication:** the letterbox math in `BitmapSubtitleOverlay` and
the pool-sizing in `MpvGLView.readMpvVideoSize()` must get video
dimensions from a different source when Phase 2 is active.

**Decision:** read width/height from the sidecar's
`jf_video_dimensions` (codec context `width/height`). For the bitmap
sub overlay, that's already event-carried as `sourceWidth`/`sourceHeight`
— the overlay's letterbox container just needs the player-level video
rect, which we derive from the VT format description.

### Q2. Does `audio-pts` exist on iOS libmpv?

**A (from libmpv 0.35+ docs):** Yes — standard observable property,
double, returns the timestamp of the audio PCM that's just been
queued into the AO. Exactly what we want as a master clock.

**Decision:** observe `audio-pts` alongside the existing properties
in `eventLoop()`. Cache as atomic double on `HybridNativeMpv`.

### Q3. Does VT on iOS accept nv12 and p010 as output formats?

**A (from Apple docs + historical usage):** Yes since iOS 11 for
nv12, iOS 14 for p010 (when paired with HEVC Main 10). Both via
`VTDecompressionSessionCreate` with
`kCVPixelBufferPixelFormatTypeKey` in the
`destinationImageBufferAttributes`.

**Implication:** no surprises expected. We'll still smoke-test on
2a to be sure.

### Q4. Does `AVSampleBufferDisplayLayer` accept DV configuration?

**A (from WWDC23 "Explore HDR video editing" + iOS 17 release notes):**
Yes for profile 5 and 8.1. The DV config box (dovi ISO BMFF box)
attaches to the `CMFormatDescription` via
`kCMFormatDescriptionExtension_DolbyVisionConfiguration`. iOS 17+
is required.

**Implication:** Phase 2c DV support is gated on iOS 17+. Fall back
to HDR10-tagged output on iOS 16 and below. Profile 7 still unsupported.

**Pending hard confirm:** test a known-good p5 file on iPhone 15 Pro
before claiming victory in 2c.

### Q5. Bitstream filter chain for HEVC in MKV / MP4?

**A (from FFmpeg source):** `hevc_mp4toannexb` is the correct filter
for HVCC-packaged streams (MKV, MP4, MOV). For streams already in
Annex-B byte-stream format (TS, raw HEVC), pass packets through
unchanged. Detection: `extradata[0] == 1` indicates HVCC (length-
prefixed NALs with a config record); anything else is Annex-B.

Analogous for H.264: `h264_mp4toannexb` for AVCC, passthrough for
Annex-B.

**Decision:** open the bitstream filter unconditionally with the
codec's `*_mp4toannexb` variant. FFmpeg's filter is a no-op on
streams that don't need conversion — safe to always apply.

---

## 2a — harness verification log

_(populate as each smoke test runs)_
