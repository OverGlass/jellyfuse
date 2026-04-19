# Phase 2 — AVSampleBufferDisplayLayer video + native 10-bit HDR

Tracked work: extends `feat/player-native-video-pipeline`. Status: **design
draft, pre-spike.** This doc is the plan-of-record before any code lands
on 2a.

> **Scope tl;dr** — stop asking mpv to render pixels. Keep mpv as the
> demuxer/audio decoder/subtitle engine. Spin up a parallel libavformat
> reader + VideoToolbox decoder that produces CVPixelBuffers (nv12 for
> 8-bit, p010 for 10-bit HDR) and feeds them directly to the existing
> `AVSampleBufferDisplayLayer`. Net: ditch the GPU→CPU→GPU readback
> (`hwdec=videotoolbox-copy`), unlock native 10-bit HDR, keep Dolby
> Vision on the table.

---

## 1. Motivation

### 1.1 What we ship today (Phase 0)

```
mpv demux ─► mpv decode (VT hwdec) ─► CPU readback ─► mpv render_ctx (GLES)
                                                      │
                                                      ▼
                                        BGRA IOSurface pool (8-bit)
                                                      │
                                                      ▼
                                        AVSampleBufferDisplayLayer
```

- `hwdec=videotoolbox-copy` (not zero-copy). Every frame goes
  GPU→CPU→GPU. Bounded but wasteful — ~15-25% extra GPU time on 4K
  content measured on an A16.
- **nv12 → BGRA conversion** happens in libmpv's GLES shader. Works.
- **p010 (10-bit)** is silently downsampled to 8-bit during the
  readback. No HDR signal reaches the compositor.
- **Dolby Vision** is impossible — libmpv has no code path to surface
  DV RPUs, and the GLES pipeline tops out at SDR Rec.709 anyway.

### 1.2 Why we can't just flip `hwdec=videotoolbox` (zero-copy)

Two confirmed bugs in libmpv's iOS GLES interop, already documented in
`HybridNativeMpv.swift`:

1. **nv12 color matrix is wrong** — straight `videotoolbox` produces a
   heavy green tint (Rec.601 primaries applied to Rec.709 content, or
   vice-versa — we never got a clean repro).
2. **p010 is rejected outright** — the GLES texture cache has no p010
   pixel format registered; "Format unsupported. Initializing texture
   for hardware decoding failed" then blue/black screen.

Both are in libmpv's source, not something we can work around in
config. Real fix requires either (a) patching libmpv's `vo_libmpv`
interop or (b) a Metal backend (`libmpv_gpu_context_metal` doesn't
exist upstream; would be a multi-week port). Neither is justified —
Phase 2 goes around the problem by not using mpv's renderer at all.

### 1.3 What Phase 2 buys us

| Capability                            | Phase 0 |                 Phase 2                 |
| ------------------------------------- | :-----: | :-------------------------------------: |
| 8-bit SDR H.264 / HEVC                |   ✅    |                   ✅                    |
| Zero-copy (no CPU readback)           |   ❌    |                   ✅                    |
| 10-bit HDR10 HEVC                     |   ❌    |                   ✅                    |
| HLG                                   |   ❌    |                   ✅                    |
| Dolby Vision profile 5 (single-layer) |   ❌    |         ✅ (spike needed, §8.3)         |
| Dolby Vision profile 7/8              |   ❌    | 🟡 (deferred; profile 8.1 likely; §8.3) |
| AV1 (on A17 Pro+ / M3+)               |   ❌    | 🟡 (out of scope for 2c, notes in §14)  |
| Battery / thermals on 4K              |  poor   |                 better                  |

### 1.4 What Phase 2 does **not** buy us

- It does not help Android. Android gets a separate track later (`vo=gpu`
  with the Android Surface is already wired and works; only iOS has
  the bugs above).
- It does not replace mpv's audio path, sub engine, track selection,
  cache, or seek planner. Those keep working unchanged.
- It does not add new codec support. VideoToolbox's codec matrix is
  the ceiling. Anything VT rejects (VC-1, MPEG-2, old Xvid rips, AV1
  on pre-A17 hardware) falls back to Phase 0.
- It does not touch the JS/React surface. Props, listeners, overlays
  stay bit-identical. The switch is entirely inside the Nitro module.

---

## 2. Non-goals (explicitly out of scope for Phase 2)

1. **Replacing mpv for audio or subs.** Audio stays on mpv's AO
   (`ao_audiounit`, `audio-exclusive=yes`). Subs stay on the Phase 1/3
   pipeline (text via `sub-text`, bitmap via sidecar ffmpeg).
2. **DRM.** Jellyfin serves cleartext; no FairPlay work.
3. **Upstream libmpv patches.** We intentionally sidestep rather than
   fork.
4. **Android / tvOS / Catalyst.** Phase 2 is iPhone + iPad only. tvOS
   rides on the same AVSampleBufferDisplayLayer code but needs its own
   test pass (not budgeted here). Android keeps `vo=gpu`. Catalyst
   inherits iPhone code but needs a display-p3 verification pass.
5. **HDR10+ dynamic metadata.** Static HDR10 only. Dynamic metadata
   would need per-frame SEI extraction and a different AVFoundation
   API surface.
6. **Live HDR tone-mapping policy UI.** iOS handles SDR fallback
   automatically when the display can't do HDR; no in-app "force SDR"
   toggle.
7. **Metal video layer.** `AVSampleBufferDisplayLayer` is sufficient —
   it composes on the display pipeline and hands off to PiP. No
   `CAMetalLayer` rework.

---

## 3. End-state architecture

```
                       ┌──────────────────────────────────────────┐
                       │              mpv core                    │
                       │   demux + audio decode + sub parse       │
                       │                                          │
                       │   video=no   (no video decode, no render)│
                       │   audio-pts  ── master clock             │
                       └──────────────────────────────────────────┘
                                 │                    │
                   audio PCM ────┘                    └──── sub events
                         │                                       │
                         ▼                                       ▼
                   ao_audiounit                         sub-text / sid observers
                   (unchanged)                          ├─ text → JS overlay
                                                        └─ bitmap → jf_bitmap_sub_* → JS overlay

                       ┌──────────────────────────────────────────┐
                       │        Video sidecar (Phase 2)           │
                       │                                          │
                       │   libavformat (parallel HTTP open)       │
                       │        │                                 │
                       │        ▼                                 │
                       │   AVBitStreamFilter (mp4→annexb)         │
                       │        │                                 │
                       │        ▼                                 │
                       │   VTDecompressionSession                 │
                       │    - nv12  (8-bit) or                    │
                       │    - p010  (10-bit)                      │
                       │        │                                 │
                       │        ▼                                 │
                       │   CVPixelBuffer                          │
                       │    (native format, IOSurface-backed,     │
                       │     color tagged, DV metadata attached)  │
                       │        │                                 │
                       │        ▼                                 │
                       │   presentation gate (against audio-pts)  │
                       │        │                                 │
                       └────────┼─────────────────────────────────┘
                                ▼
                         CMSampleBuffer
                                │
                                ▼
                  AVSampleBufferDisplayLayer  ─────►  AVPictureInPictureController
                                │                     (unchanged — same layer)
                                │
                                └──► CMTimebase (driven by mpv audio clock, unchanged)
```

**Two threads, two demux contexts, one display layer, one clock.**
That's the entire shape. Everything else in the doc is about making
each of those pieces robust.

---

## 4. Sub-phase roadmap

Four sub-phases, each with a ship gate and a rollback story. No
sub-phase is shippable to main unless Phase 3 has already landed
(bitmap subs) AND the preferred-subtitle-language bug is fixed — both
are already in flight. 2a-2c are dev-flag only; 2d is the rollout.

| #   | Scope                                               | Effort    | Flag state      | Ship gate                                                              |
| --- | --------------------------------------------------- | --------- | --------------- | ---------------------------------------------------------------------- |
| 2a  | VT decode harness alongside mpv (mpv still renders) | ~3 d      | hidden dev flag | VT session opens; we can dump raw CVPixelBuffers; no display switch    |
| 2b  | Switch display source to VT; `video=no` on mpv      | ~6 d      | hidden dev flag | 8-bit DirectPlay/DirectStream/Transcode SDR plays A/V in sync          |
| 2c  | 10-bit / HDR10 / HLG + Dolby Vision                 | ~4 d      | hidden dev flag | A verified 10-bit HEVC file shows HDR on iPhone 15 Pro OLED            |
| 2d  | User-facing flag + fallback policy + Settings entry | ~2 d      | user opt-in     | Toggle works; fallback to Phase 0 fires on the documented trigger list |
|     | **Total**                                           | **~15 d** |                 | Flag-gated rollout, default OFF                                        |

Budget: three weeks of focused work, not two. The 2a→2b cutover is the
landmine — sync is the hard problem, not the decoder.

### 2a — VT decode harness (no display change)

**Goal:** prove we can demux + decode + get CVPixelBuffers. Nothing
displays yet.

- Add `jf_video_*` C family to `FFmpegBridge.mm` (full API in §5).
- Add a hidden dev-only option to load(): `debug_enableNativeVideoHarness:
boolean`. When set, Swift spawns the video sidecar in "dry-run" mode:
  decode frames, log first 30 PTS + pixel format + dimensions + color
  tags, then drop.
- mpv **still renders** in this phase (GL path unchanged). Harness is
  passive.
- Smoke tests: H.264 1080p MP4, HEVC 4K MKV, HEVC 10-bit HDR MKV,
  H.264 HLS transcode. Confirm PTS monotonic, dimensions stable,
  pixel format matches bit depth, color tags populated for HDR.

**Ship gate:** harness enabled in dev builds, QA verifies decode logs
look sane on the four smoke tests. No user-visible change.

**Rollback:** delete the flag check. Zero risk to main path.

### 2b — Cut over display source + `video=no` on mpv

**Goal:** VT-produced frames hit the screen. mpv stops touching video.

- Add `VideoSource` abstraction inside `MpvGLView`. Two impls:
  - `MpvRenderContextVideoSource` — today's path. Keeps the GLES
    pipeline intact.
  - `NativeVideoToolboxSource` — frames from `jf_video_decode_next`
    wrapped as CMSampleBuffers.
- Nitro `attachPlayer(instanceId, options: { source: "mpv" | "native" })`
  — choose at attach time, not swappable live. Default stays `"mpv"`.
- Sync logic (§6) lives in the native source. Display link triggers a
  pull; we gate presentation against mpv's `audio-pts`.
- Set `mpv_set_option_string(mpv, "video", "no")` **only when** the
  caller requested the native source. Otherwise leave video=auto.
- `CMTimebase` already exists and is already driven by
  `applyPlaybackState(position:...)` — no change. PiP control path
  stays bit-identical.

**Ship gate:**

- 8-bit SDR H.264 1080p: no A/V drift over 5 min on device.
- 8-bit SDR HEVC 2160p: no tearing, no stutter during pause/seek.
- Jellyfin transcode HLS: segment boundaries don't produce artifacts.
- All three playback methods (DirectPlay / DirectStream / Transcode)
  work identically.
- PGS sub overlay still aligns with video rect (verify letterbox math
  in `BitmapSubtitleOverlay` still holds — it reads `dwidth`/`dheight`
  from mpv, which stays correct even with `video=no` because mpv still
  sees the stream header).

  > **Verify:** does mpv still publish `dwidth`/`dheight` with
  > `video=no`? Phase 2a spike must answer this. If not, read from our
  > VT source's format description instead. The bitmap overlay already
  > uses event-carried `sourceWidth`/`sourceHeight`, so this is only a
  > concern for the main video rect letterbox.

**Rollback:** flip the attach option back to `"mpv"`. The Phase 0
code path is still compiled and tested on every build.

### 2c — Native 10-bit / HDR10 / HLG / Dolby Vision

**Goal:** HDR signal makes it to the OLED.

- Pixel format selection: inspect `AVCodecParameters->bits_per_raw_sample`
  (and/or codec profile for HEVC main10). 8-bit → nv12
  (`kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange`). 10-bit → p010
  (`kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange`).
- Color tagging: set primaries/transfer/matrix on each
  `CVPixelBuffer` from the stream's `AVColorPrimaries`,
  `AVColorTransferCharacteristic`, `AVColorSpace`. Mapping table in §8.2.
- Static HDR10 mastering display + content-light-level metadata: plumb
  `AVMasteringDisplayMetadata` and `AVContentLightMetadata` into the
  pixel buffer's `kCVImageBufferMasteringDisplayColorVolumeKey` /
  `kCVImageBufferContentLightLevelInfoKey`.
- Dolby Vision: requires a spike (§8.3). Profile 5 is the realistic
  2c target (single-layer, no enhancement layer, RPU in-band). Profile
  7 (dual-layer) is almost certainly out of scope — needs EL
  reassembly. Profile 8.1 ships as HDR10 with optional DV RPU;
  realistic with the same pipeline as p5.
- `UIWindowScene.requestGeometryUpdate` / `preferredDisplayCriteria`
  on the hosting window to request HDR mode from iOS.

**Ship gate:**

- One known-good HDR10 HEVC file (e.g. LG HDR Demo, or a UHD Blu-ray
  rip) plays on iPhone 15 Pro with measurable luminance on a
  spot-check (visual inspection against a reference device).
- HLG broadcast sample: no color shift, no clipping.
- Same files on non-HDR displays (iPad mini 6, iPhone SE) render as
  SDR without washout (iOS handles the tone-map if we tag correctly).

**Rollback:** force 8-bit nv12 output regardless of stream bit depth.
Downconvert in VT. Worse quality but still plays.

### 2d — Feature flag + fallback + Settings UI

**Goal:** user-facing opt-in with robust fallback.

- New local-only MMKV entry: `ENABLE_NATIVE_VIDEO_PIPELINE` (boolean,
  default `false`). Stored separately from the server-persisted
  `UserConfiguration` — this is a device capability flag, not a user
  preference the server should know about.
- Add a Settings entry under **Advanced → Playback**:
  > **Native video pipeline** (beta)
  > Use iOS VideoToolbox for zero-copy decoding and HDR. Falls back to
  > the legacy path on unsupported content.
- Playback resolver reads the flag once per session (player mount) and
  passes `source: "native" | "mpv"` to `attachPlayer`.
- Fallback triggers, in priority order (any one → switch to `"mpv"`):
  1. Codec not in `VTSupportedDecoders()` (AV1 on pre-A17, VC-1,
     MPEG-2, old DivX).
  2. `VTDecompressionSessionCreate` fails at open time.
  3. Three consecutive `VTDecodeFrame` errors within 2 s (transient
     hardware issue — fall back this session).
  4. Dolby Vision profile 7 (we don't support it).
  5. Container we can't demux with libavformat (should never happen
     for Jellyfin; guardrail only).
- Fallback is **per-session**, one-way. Once we fall back, we don't
  try to re-enable within the same load. A session restart re-reads
  the flag.
- Fallback emits a dev-only log; no user-visible toast. The goal is
  that "flag on" means "best effort" — users don't care why we fell
  back, they just want it to play.

**Ship gate:**

- Flag toggles the code path (verified with two builds).
- Each fallback trigger fires on a curated test file.
- Flag off = bit-identical behaviour to main branch.

---

## 5. Native C API — `jf_video_*` family

Mirrors the shape of `jf_bitmap_sub_*` for consistency: opaque handle,
C linkage, bridged to Swift via `@_silgen_name` (no bridging header).
Lives in the same `FFmpegBridge.mm` compilation unit.

```c
// Opaque context — Swift holds a raw pointer, C owns the lifetime.
struct jf_video_ctx;

// ── lifecycle ─────────────────────────────────────────────────────────

// Open the stream and the decoder. Returns NULL on any failure
// (network, no video stream, codec unsupported by VT). Caller must
// check and fall back to the legacy path.
//
// `start_seconds`: seek target before first decode. 0 for start-at-0.
// `user_agent`:    HTTP UA pinned on the sidecar open. Pass the same
//                  value as mpv's `user-agent` property (see
//                  HybridNativeMpv.currentUserAgent) — Jellyfin
//                  tolerates UA mismatches but session-affinity
//                  transcodes prefer pinning.
struct jf_video_ctx *jf_video_open(const char *url,
                                    double start_seconds,
                                    const char *user_agent);

void jf_video_close(struct jf_video_ctx *ctx);

// Cancels a blocking `decode_next`. Safe from any thread. `close`
// calls this internally, so callers only need it for seek-in-flight
// abort.
void jf_video_cancel(struct jf_video_ctx *ctx);

// ── introspection (for fallback gating) ───────────────────────────────

// AVCodecID as an int. Swift maps to a human-readable name for logs.
int  jf_video_codec_id(struct jf_video_ctx *ctx);
// 8 or 10. 0 if unknown.
int  jf_video_bits_per_sample(struct jf_video_ctx *ctx);
// Dimensions from the codec context. 0/0 if unknown.
void jf_video_dimensions(struct jf_video_ctx *ctx, int *w, int *h);
// Color tags for CVPixelBuffer attachment. All enums as int; Swift
// maps to kCVImageBuffer* constants.
void jf_video_color_info(struct jf_video_ctx *ctx,
                          int *primaries,
                          int *transfer,
                          int *matrix,
                          int *range);
// HDR10 mastering + content light level. `has_*` is 0/1. If 0, the
// pointers below are untouched (caller should zero-init).
//
// `mastering`: fixed-point {RGBx (0-50000), white (0-50000), max_luma (1e-4 nits), min_luma (1e-4 nits)}
//              — exact layout matches FFmpeg AVMasteringDisplayMetadata.
//              Swift converts to AVFoundation's `CMMastering...`
//              payload via the CV* keys.
// `cll`:       {MaxCLL, MaxFALL} in cd/m².
int  jf_video_hdr_mastering(struct jf_video_ctx *ctx, uint32_t mastering[10]);
int  jf_video_hdr_cll(struct jf_video_ctx *ctx, uint16_t cll[2]);
// Dolby Vision profile if present, -1 otherwise. Extracted from
// stream-side configuration (dovi config box or RPU on first frame).
int  jf_video_dolby_vision_profile(struct jf_video_ctx *ctx);

// ── decode loop ───────────────────────────────────────────────────────

// Opaque CVPixelBuffer handle — Swift casts to CVPixelBufferRef.
// Caller owns a retain; release with CVBufferRelease.
typedef void *jf_pixel_buffer_t;

// Block until the next video frame is decoded. Swift pulls from a
// background queue.
//
// Returns:
//    0 = frame decoded; `*out_pb` is a retained CVPixelBuffer. Caller
//        owns it. `*out_pts_seconds` is the presentation time on the
//        stream's timeline (NOT a host-clock time).
//    1 = EOF.
//   <0 = error; session is dead, caller should tear down.
//
// Flow:
//   1. av_read_frame → av_packet
//   2. AVBitStreamFilter (mp4→annexb / hevc_mp4toannexb)
//   3. wrap as CMSampleBuffer (CMBlockBuffer + CMFormatDescription)
//   4. VTDecompressionSessionDecodeFrame (sync variant for back-pressure)
//   5. output callback pushes decoded CVPixelBuffer onto a bounded
//      queue; this function dequeues + tags color + returns.
int jf_video_decode_next(struct jf_video_ctx *ctx,
                          double *out_pts_seconds,
                          jf_pixel_buffer_t *out_pb);

// Flush decoder + demuxer and resume decoding at `seconds`.
// Reissues parameter sets to VT. `jf_video_cancel` must NOT be
// in effect — caller must restart the decode thread after seek.
int jf_video_seek(struct jf_video_ctx *ctx, double seconds);
```

### API design notes

1. **One file, one context.** No attempt to share a demuxer between
   subs and video; audio too. The HTTP cost of two or three concurrent
   HLS manifests is negligible. Coupling them would be a mistake —
   mpv's demuxer is optimised for its pipeline (cache, seek, gap
   handling); ours is a dumb pull loop.
2. **Sync-variant VT decode with back-pressure** — we set
   `kVTVideoDecoderSpecification_EnableHardwareAcceleratedVideoDecoder`
   and call `VTDecompressionSessionDecodeFrame` with
   `kVTDecodeFrame_EnableTemporalProcessing`. The output callback
   pushes onto a small queue (3-frame depth). `decode_next` blocks on
   the queue. This keeps memory bounded and stalls the demuxer when
   we fall behind (instead of growing an unbounded queue).
3. **Pixel buffers come straight from VT's pool.** No pre-allocated
   `CVPixelBufferPool` on our side — VT owns it. We tag color on top
   before handing to Swift.
4. **Interrupt callback** — same pattern as `jf_bitmap_sub_*`. Lets
   `close` unblock a decode parked inside `av_read_frame` waiting on
   HTTP bytes.
5. **No ref to the Swift side from C.** Everything flows Swift →
   function call → return. Output callback invokes a C function
   pointer only on the C side; queue dequeue happens in the caller's
   thread.
6. **Unicode filenames / tv-parental-guide control characters in
   titles** are not our problem — URLs from Jellyfin are
   percent-encoded already.

---

## 6. The sync model

**The hard problem in Phase 2 is not decoding — it's sync.** Two
demuxers, one audio timeline. We have to guarantee video frames
display against the same wall clock mpv uses for audio. Get it wrong,
get lip-sync drift.

### 6.1 Master clock = mpv audio

mpv's `audio-pts` is ground truth. Not `playback-time` (which is
derived and may lag by a display frame), not `time-pos` (which includes
mpv's internal audio-video offset). We observe `audio-pts` on the
existing property-observer loop and cache it (atomic double, read by
the presentation gate).

Fallback if mpv isn't producing audio-pts yet (first second after
load): use `CMClockGetHostTimeClock` offset from our first video PTS.
This is only a bootstrap path — the moment audio-pts becomes valid we
switch to it.

### 6.2 Presentation gate

```
                    VT output queue
                         │
                         ▼
                ┌────────────────────┐
                │  presentation gate │
                │                    │
                │  if frame.pts <= audio-pts + leadBudget:
                │    enqueue on AVSampleBufferDisplayLayer
                │    mark as presented
                │  elif frame.pts > audio-pts + dropBudget:
                │    HOLD — wait for next display-link tick
                │  else:
                │    (rare) audio is ahead — DROP frame, log
                └────────────────────┘
                         │
                         ▼
                AVSampleBufferDisplayLayer.enqueue
```

- `leadBudget`: +33 ms (one frame at 30 fps). Frame is "on time or
  slightly ahead of audio" → present it.
- `dropBudget`: +100 ms. Audio is >100 ms behind → hold.
- `< -50 ms` (frame PTS is 50+ ms behind audio): drop. Happens after
  a seek when the VT pipeline is catching up.

Numbers are starting points; tune against the 24 fps HDR HEVC smoke
test. The goal is < ±1 frame of visible drift at all times.

### 6.3 Enqueue strategy

`AVSampleBufferDisplayLayer` has its own timebase (we set it to host
clock up-front, driven by `applyPlaybackState`). We CANNOT feed it
the raw stream PTS — its scheduler would try to display frames at
those wall-clock times and fall apart on first seek.

Instead:

- Stamp each sample buffer's PTS with `controlTimebase.time +
CMTimeMake(1, 60)` (one display frame ahead of current timebase
  time), with `DisplayImmediately` attachment.
- This matches what the Phase 0 path already does
  (`makeSampleBuffer(from:)` uses `CMClockGetHostTimeClock`).
- The presentation gate does the real synchronisation; the
  display layer just composites the most recent enqueued frame.

### 6.4 Pause, rate, seek

- **Pause** (`audio-pts` stops advancing): gate sees `audio-pts ==
previous audio-pts` → stops enqueuing. Layer holds the last frame.
  No special-case needed.
- **Rate change** (`speed` property): mpv's `audio-pts` keeps stream
  time; the rate affects how fast it advances in wall-clock. Our
  gate reads `audio-pts` directly, so rate changes are transparent.
  The `CMTimebase` rate is still updated by `applyPlaybackState` for
  the PiP scrubber.
- **Seek**: the hardest case. Sequence:
  1. Swift sees seek command, calls `player.seek(positionSeconds:)`
     (existing path — fires `mpv_set_property` for `time-pos`).
  2. Swift calls `jf_video_cancel` on the sidecar, tears down the
     decode thread.
  3. Swift calls `jf_video_seek(ctx, positionSeconds)` and restarts
     the decode thread.
  4. mpv's audio comes back online first (it reuses cached packets).
     We drop VT frames that are behind `audio-pts - 50 ms` until we
     catch up.
  5. First in-window VT frame is enqueued with `flushAndRemoveImage`
     first — clears the stale frame that was on screen.

### 6.5 Live / indefinite streams

Jellyfin doesn't serve live HLS that I'm aware of (it's all VOD).
We assume VOD; live is explicitly out of scope. If/when live lands,
the gate model still works — `audio-pts` keeps advancing, our
reader keeps pace. The seek path becomes a no-op.

### 6.6 EOF

mpv fires `eof-reached` → we fire the existing `onEnded` listener.
VT may hit EOF first (slight offset possible at file end); we
simply stop enqueuing. No layer-level EOF signal needed.

---

## 7. Swift-side changes

### 7.1 New: `NativeVideoSource`

```swift
// In modules/native-mpv/ios/
final class NativeVideoSource {
    private let ctx: OpaquePointer              // jf_video_ctx*
    private weak var displayLayer: AVSampleBufferDisplayLayer?
    private weak var player: HybridNativeMpv?   // for audio-pts read
    private var decodeThread: Thread?
    private var isCancelled = atomic<Bool>(false)
    private let framePipeline = BoundedQueue<TimedFrame>(capacity: 3)

    func start(layer: AVSampleBufferDisplayLayer, player: HybridNativeMpv)
    func stop()
    func seek(to seconds: Double)
}

struct TimedFrame {
    let pixelBuffer: CVPixelBuffer
    let streamPts: Double        // seconds on the stream timeline
}
```

### 7.2 `MpvGLView` → `MpvVideoView` with two render backends

```swift
protocol VideoSource: AnyObject {
    func attach(to view: MpvVideoView, player: HybridNativeMpv, mpvHandle: OpaquePointer)
    func detach()
    func seek(to seconds: Double)  // called after player.seek()
}

final class MpvRenderContextSource: VideoSource { /* today's MpvGLView guts */ }
final class NativeVideoToolboxSource: VideoSource { /* new */ }

final class MpvVideoView: UIView {
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
    private var source: VideoSource?
    // PiP, CMTimebase, display link — stay here. applyPlaybackState stays here.
}
```

Keep the name `MpvGLView` for the legacy source for grepability, but
move the common surface-layer logic up to `MpvVideoView`. `HybridMpvVideoView`
chooses the source from the attach options.

### 7.3 Changes to `HybridNativeMpv.swift`

- New `load()` option (in `MpvLoadOptions`, §9): `useNativeVideoPipeline:
boolean`. When true, set `video=no` **before** mpv_initialize and
  skip the `vid=auto` flip on attach.

  > **Gotcha:** `video=no` at init is different from `vid=no` + flip.
  > We'll need to verify mpv still fires `track-list` for video
  > tracks when `video=no` — the UI depends on knowing the video
  > exists. Expected behaviour: yes, mpv still parses and lists.
  > Needs confirmation during 2a spike.

- Expose `currentAudioPts` as a method on HybridNativeMpv. Observes
  `audio-pts` (double) and caches atomically. Read by
  `NativeVideoToolboxSource` from the display thread.

- Propagate the user-agent already captured in `currentUserAgent` to
  `jf_video_open` (same plumbing as `jf_bitmap_sub_open`).

### 7.4 Thread model

| Thread                    | Owns                                                       |
| ------------------------- | ---------------------------------------------------------- |
| main                      | AVSampleBufferDisplayLayer enqueue, CMTimebase writes, PiP |
| `jf.native-mpv.events`    | mpv event loop, property observers (unchanged)             |
| `jf.native-video.decode`  | **new** — libavformat read + VT decode                     |
| `jf.native-video.present` | **new** — CADisplayLink, presentation gate                 |
| `jf.bitmap-sub.decode`    | existing — unchanged                                       |

Two new background threads. The decode thread is CPU-bound on demux
and hands off to VT hardware; the present thread is a display-link
tick driver that consumes from the frame queue.

---

## 8. Color / HDR / Dolby Vision

### 8.1 Pixel format selection

| Stream bit depth | VT output format       | CVPixelBuffer type                                 |
| ---------------- | ---------------------- | -------------------------------------------------- |
| 8                | nv12                   | `kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange`  |
| 10               | p010                   | `kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange` |
| 12 (rare)        | downcast to p010 by VT | `kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange` |

We request the format via the VT `ImageBufferAttributes` session
parameter. If VT refuses (should only happen on ancient hardware
we don't support), fall back to Phase 0.

### 8.2 Color tagging

Every CVPixelBuffer gets four attachments, set in `NativeVideoSource`
before enqueue. Source: FFmpeg `AVCodecParameters->color_*` fields.

| FFmpeg field      | CVPixelBuffer key                   | Note                                            |
| ----------------- | ----------------------------------- | ----------------------------------------------- |
| `color_primaries` | `kCVImageBufferColorPrimariesKey`   | ITU_R_709_2 / ITU_R_2020 / P3_D65               |
| `color_trc`       | `kCVImageBufferTransferFunctionKey` | ITU_R_709_2 / SMPTE_ST_2084_PQ / ITU_R_2100_HLG |
| `color_space`     | `kCVImageBufferYCbCrMatrixKey`      | ITU_R_709_2 / ITU_R_2020                        |
| `color_range`     | range bit on the format description | video-range = 16-235; full-range = 0-255        |

HDR10 static metadata (if present on the stream):

- `AVMasteringDisplayMetadata` → `kCVImageBufferMasteringDisplayColorVolumeKey`
- `AVContentLightMetadata` → `kCVImageBufferContentLightLevelInfoKey`

Missing HDR metadata on a p010 stream: tag as PQ with a sensible
default mastering (1000-nit, P3). Better than untagged — iOS's default
tone-mapping assumes Rec.709 if the transfer fn is unset, which
crushes HDR blacks.

### 8.3 Dolby Vision — spike needed before 2c

Profiles we'll see in real Jellyfin libraries (in priority order):

- **Profile 5** — single-layer, DV-only (no HDR10 fallback), in-band
  RPU. Most common from UHD Blu-ray DV remuxes.
- **Profile 8.1** — HDR10 base + DV RPU. BD-DV discs. Plays as HDR10
  if we don't parse RPU, which is a totally acceptable 2c outcome.
- **Profile 7** — dual-layer (base + enhancement). UHD Blu-ray. **Out
  of scope for 2c.** Would need EL reassembly. Fall back to Phase 0.

AVFoundation path for p5/p8: attach the `kCMFormatDescriptionExtension_
DolbyVisionConfiguration` extension on the format description, with
the DV config box bytes from libavformat's side-data
(`AV_PKT_DATA_DOVI_CONF`). iOS's display pipeline handles the RPU.

**Pre-2c spike tasks:**

1. Confirm iOS accepts DV config on `AVSampleBufferDisplayLayer` (docs
   are sparse; last checked in iOS 17 WWDC).
2. Identify a profile 5 sample file we can test against.
3. Profile 7 detection + fallback path works end-to-end.

If the spike fails, 2c ships HDR10 + HLG only, DV is deferred to a
Phase 5.

### 8.4 Display capability

- `UIWindowScene.preferredDisplayCriteria` (iOS 17.2+) — set to
  60fps / Dolby Vision when DV content is playing, HDR/60fps when
  HDR10, omit when SDR.
- Without this, iOS may leave the display in SDR mode even for HDR
  content (it does auto-enter for full-screen `AVPlayer`, but
  AVSampleBufferDisplayLayer requires the explicit request).
- Bracket with `preferredDisplayCriteria = nil` on detach.

---

## 9. JS / Nitro surface changes

### 9.1 `MpvLoadOptions` — one new field

```ts
export interface MpvLoadOptions {
  // ... existing fields ...

  /**
   * When true, the player uses the Phase 2 native video pipeline
   * (parallel VideoToolbox decode → AVSampleBufferDisplayLayer,
   * mpv video=no). When false or undefined, uses the Phase 0
   * mpv-renders-to-GLES path.
   *
   * The JS layer reads this from the local `ENABLE_NATIVE_VIDEO_PIPELINE`
   * MMKV flag; the module does not inspect settings on its own.
   *
   * iOS only in Phase 2. Ignored on Android / tvOS.
   */
  useNativeVideoPipeline?: boolean;
}
```

### 9.2 `attachPlayer` signature

```ts
attachPlayer(
  instanceId: string,
  options?: { source?: "mpv" | "native" },
): void;
```

`options.source` defaults to `"mpv"`. Passing `"native"` opts into the
Phase 2 path. The prop flows from the player screen:

```tsx
const useNative = useMMKVBoolean("ENABLE_NATIVE_VIDEO_PIPELINE")[0] ?? false;
// ...
<MpvVideoView
  hybridRef={(r) => r.attachPlayer(player.instanceId, { source: useNative ? "native" : "mpv" })}
/>;
```

No new listeners, no new events. The module is bit-identical on the
observer surface.

### 9.3 Settings entry

Add to `features/settings/screens/settings-screen.tsx` under a new
**Advanced** section (Phase 2d):

```tsx
<Toggle
  label="Native video pipeline"
  sublabel="Experimental. Zero-copy decoding + native HDR."
  value={enableNativeVideoPipeline}
  onChange={setEnableNativeVideoPipeline}
/>
```

Store in local MMKV (not server UserConfiguration — this is a
per-device capability, not a user preference).

### 9.4 Playback resolver (no changes for 2a-2c; trivial for 2d)

The resolver (`services/playback/resolver.ts`) decides DirectPlay vs
DirectStream vs Transcode. Phase 2 is orthogonal — all three methods
produce a stream URL that libavformat can open. No resolver change
needed.

In 2d, the hook that creates load options reads the flag:

```ts
const useNative = storage.getBoolean("ENABLE_NATIVE_VIDEO_PIPELINE") ?? false;
return {
  // ... existing options ...
  useNativeVideoPipeline: useNative,
};
```

---

## 10. Edge cases & failure modes

### 10.1 VT decode error mid-stream

Symptom: `VTDecompressionSessionDecodeFrame` returns a non-zero
status (decode failed, hardware busy, format change).

Response:

- Transient (1-2 errors in a second): skip the frame, continue.
- Persistent (3+ errors in 2 s): tear down VT, fall back to Phase 0
  _for this session only_. Emit `addErrorListener` with a recoverable
  code so JS can log without showing an error screen.
- Catastrophic (session creation fails): fail the load; JS shows
  an error toast.

### 10.2 Format change mid-stream

Some HLS streams have resolution ladders. The bitstream filter
handles this automatically — a new SPS/PPS arrives, we rebuild the
CMFormatDescription, VT re-creates its decoder internally.

Caveat: color-space changes (SDR → HDR mid-stream) are not handled by
a single VT session. Rare but real on some broadcast feeds. If we
detect one, tear down and rebuild the session.

### 10.3 Network stalls on the sidecar

The video sidecar opens its own HTTP connection. If that connection
stalls while mpv's keeps flowing:

- Audio continues (mpv has cache).
- Video freezes.
- After 15s (the `rw_timeout`), sidecar errors out → fall back to
  Phase 0 for the session.

Acceptable failure mode. The server is supposed to serve both
connections equivalently — if one stalls and the other doesn't, that
points at a CDN issue we can't solve at the client.

### 10.4 PTS rollover

H.264/HEVC streams can have 33-bit PTS wraparound at ~26 hours of
continuous content. Not a concern for VOD (no file is that long); not
a concern for our stream times (seconds, not timestamp ticks).

### 10.5 iOS backgrounding without PiP

`AVSampleBufferDisplayLayer` enqueue is blocked when the app is
backgrounded without PiP. Current Phase 0 path pauses the display
link. Phase 2 path does the same — pause the present thread; the
decode thread keeps filling the queue up to its capacity then blocks.
No memory growth.

### 10.6 Device with no HDR display

iOS tone-maps HDR content to SDR on the compositor when we tag it
correctly (§8.2). Tested to work on iPad mini 6 and iPhone SE.
**Explicitly test** — untagged p010 crushes blacks on these devices.

### 10.7 Thermals on 4K HDR

A real concern. 4K 10-bit HDR HEVC decode is already heavy; our
pipeline is lighter than Phase 0 (no readback, no re-upload) so this
should be a _win_, not a regression. But it needs measurement on an
iPhone 14 (A15, thermal-sensitive chassis) and an iPad Air M1.

### 10.8 Memory pressure

- VT's pool is bounded by its own sizing (typically 5-7 frames).
- Our presentation queue is bounded to 3 frames.
- Hard cap: roughly 10 × 4K × 10-bit frame = ~95 MB peak. Acceptable
  (we already use a comparable amount in the BGRA pool today).

### 10.9 Session expiration mid-playback

mpv and our sidecar both use the Jellyfin `api_key` query param; both
expire at the same time. Mitigation: the api_key has a long lifetime,
and the token refresh on session start (see `services/auth`) covers
the playback window. Not a Phase 2 concern.

---

## 11. Test matrix

| Variable          | Values                                                                    |
| ----------------- | ------------------------------------------------------------------------- |
| Codec + bit depth | H.264 8-bit · HEVC 8-bit · HEVC 10-bit HDR10 · HEVC HLG · DV p5 · DV p8.1 |
| Container         | MP4 · MKV · MOV · HLS (m4s) · HLS (ts)                                    |
| Playback method   | DirectPlay · DirectStream · Transcode                                     |
| Subtitle track    | off · SRT · ASS · PGS · VobSub · DVB · external SRT                       |
| Interaction       | no-op · pause/resume · seek fwd · seek back · rate change · scrub         |
| Surface state     | inline · fullscreen · PiP · background                                    |
| Device            | iPhone 15 Pro · iPhone 14 · iPhone SE 3rd · iPad mini 6 · iPad Air M1     |
| iOS               | 17 · 18                                                                   |
| Flag              | off (regression) · on (native path)                                       |

Total combinatorial space is absurd; we don't run all of it. Each
sub-phase picks a representative slice:

- **2a:** one file per codec+bit depth × flag on (harness only).
- **2b:** smoke × 3 playback methods × 2 devices × flag on/off
  (regression bar: Phase 0 must still work perfectly).
- **2c:** HDR10 + HLG + DV p5 × 1 HDR device × 1 non-HDR device.
- **2d:** each fallback trigger on one sample; flag-off full regression.

Owner records results in `docs/verification/native-video-pipeline-phase-2.md`.

---

## 12. Risks & mitigations

| Risk                                                         | Probability | Mitigation                                                                       |
| ------------------------------------------------------------ | :---------: | -------------------------------------------------------------------------------- |
| Sync drift in long-form HDR content                          |      M      | Audio-pts master clock; gate bounds tuned in 2b; hand-test 2h+ playback          |
| VT rejects a common codec profile we didn't anticipate       |      M      | Robust fallback; AVSampleBufferDisplayLayer error listener feeds fallback        |
| DV p5 doesn't work on AVSampleBufferDisplayLayer             |      M      | Scoped to 2c spike; if spike fails, DV deferred, HDR10/HLG still ship            |
| HLS segment boundary artifacts (SPS change)                  |      L      | Bitstream filter re-emits param sets; CMFormatDescription rebuild on change      |
| Thermal regression (unlikely but measure)                    |      L      | Profile on A15 iPhone 14 chassis against Phase 0 baseline                        |
| iOS 17→18 behaviour change in `preferredDisplayCriteria`     |      L      | Test on both; no early adoption of iOS 18-only APIs                              |
| Parallel HTTP opens double-count against a server rate-limit |     VL      | Jellyfin has no rate limit on stream endpoints; CDN handles per-IP independently |
| User toggles flag mid-session and expects it to apply        |      L      | Documented in settings help; flag reads at load time only                        |

Probability scale: Very Low / Low / Medium / High.

---

## 13. Open decisions

The ones that actually matter. Each needs a call _before_ the 2a
spike lands to avoid redoing work.

1. **VT output pool ownership.**
   - Option A: let VT own its pool; we hold pixel buffers briefly then
     release. Simpler.
   - Option B: pre-create a pool with our attributes (IOSurface
     options, color tags) and pass to VT via `ImageBufferAttributes`.
     More control, more code.
   - **Default:** A. Revisit only if we see pool churn in profiling.

2. **Presentation queue depth.**
   - 3 frames = ~125 ms at 24 fps, ~50 ms at 60 fps. Safe.
   - **Default:** 3. Re-tune against smoke tests.

3. **Decode thread QoS.**
   - `.userInitiated` — matches the mpv event thread.
   - **Default:** `.userInitiated`. `.userInteractive` would be overkill
     (we're not main-thread-critical); `.utility` would risk stutter.

4. **Fallback policy: once-per-session or once-per-app?**
   - Per-session: flag stays on, next video retries VT.
   - Per-app: one VT failure disables VT until app restart.
   - **Default:** per-session. Cheap to retry, and content types vary
     wildly.

5. **Settings placement.**
   - **Default:** Settings → Advanced → Playback → "Native video
     pipeline (beta)". Matches the placement of "Low bitrate cap" from
     last sprint.

6. **DV p5 in 2c, or defer to 2.5?**
   - **Recommend:** spike in 2c week 1; decide then. Hard deadline is
     end of 2c spike — if we haven't proven it, defer.

7. **Telemetry.**
   - Do we log fallback events to Sentry / our metrics pipe?
   - **Recommend:** yes, dev-only tag for now (post-2d consider broad
     rollout). Saves us from relying on user bug reports to learn
     about fallback triggers.

---

## 14. Out of scope / deferred

- **Phase 4 (libass-backed text subs)** — orthogonal; ships whenever
  ASS rendering becomes a real user pain point.
- **Android native pipeline** — separate track. Android's `vo=gpu` +
  SurfaceView already works; no libmpv bugs on that platform.
- **tvOS** — rides on the same code but needs an Apple TV 4K test
  pass and an HDR TV. Not budgeted in Phase 2. Defer.
- **Catalyst** — Mac external HDR displays work differently; verify
  post-2c.
- **AV1 on pre-A17 hardware** — falls back to Phase 0 (mpv software
  decode via dav1d). Acceptable.
- **HDR10+ dynamic metadata** — Phase 5 at earliest.
- **Metal video layer** — no business case.
- **DRM / FairPlay** — no Jellyfin use case.

---

## 15. Task breakdown (issues to open at kickoff)

### 2a — Harness

- [ ] Add `jf_video_open/close/cancel/decode_next/seek` stubs (no VT
      wiring yet; returns canned data). Swift silgen bindings.
- [ ] Add `jf_video_codec_id/bits_per_sample/dimensions/color_info`.
- [ ] Wire libavformat open + bitstream filter + VT session create
      behind `jf_video_*`.
- [ ] Hidden `debug_enableNativeVideoHarness` option on load().
- [ ] Decode thread + logging on the 4 smoke-test files.

### 2b — Cutover

- [ ] `VideoSource` protocol; refactor `MpvGLView` → `MpvRenderContextSource`.
- [ ] `NativeVideoToolboxSource` — decode pull + presentation gate.
- [ ] `audio-pts` atomic on `HybridNativeMpv`.
- [ ] `video=no` branch in mpv init when flag is on.
- [ ] Seek path: cancel + seek + restart decode thread.
- [ ] `attachPlayer(instanceId, { source: "native" })` option.
- [ ] Regression pass: flag-off plays bit-identically to main.

### 2c — HDR

- [ ] Pixel format selection (nv12 / p010) from stream bit depth.
- [ ] Color tagging (primaries, transfer, matrix, range).
- [ ] Mastering + CLL metadata attachment.
- [ ] DV spike: profile 5 end-to-end on AVSampleBufferDisplayLayer.
- [ ] `UIWindowScene.preferredDisplayCriteria` bracket.
- [ ] Format-change resilience (rebuild VT session on color-space change).

### 2d — Rollout

- [ ] MMKV `ENABLE_NATIVE_VIDEO_PIPELINE` flag, default off.
- [ ] Settings → Advanced → Playback toggle.
- [ ] Fallback triggers + once-per-session latch.
- [ ] Dev telemetry on fallback events.
- [ ] README + `docs/native-video-pipeline.md` update to mark Phase 2
      as shipped, flag-gated.

---

## 16. Pre-2a checklist (spike tasks — ~1 day total)

Must answer before writing production code:

1. Does mpv still publish `dwidth`/`dheight` with `video=no`?
   → Test: run mpv from CLI with `video=no`, play a file, observe
   properties.
2. Does `audio-pts` exist as a mpv property on iOS libmpv 0.x?
   → Test: `mpv_get_property` on a live session; confirm it
   returns a double and advances monotonically.
3. Does VT on iOS 17 accept both nv12 and p010 as output formats?
   → Test: create sessions with each ImageBufferAttributes, confirm
   success on iPhone 15 Pro + iPad mini 6.
4. Does `AVSampleBufferDisplayLayer` accept CMFormatDescriptions
   carrying DV config?
   → Test: enqueue a DV-tagged sample buffer, observe layer
   `status` and `error`.
5. What's the right bitstream filter chain for HEVC in MKV?
   → `hevc_mp4toannexb` if HVCC, passthrough if already annex-B.
   Check both.

Result of the spike lands in `docs/verification/native-video-pipeline-phase-2.md`,
which 2a reads from.

---

_Document owner: whoever picks up 2a. Keep this file up-to-date as
decisions firm — an outdated plan is worse than no plan._
