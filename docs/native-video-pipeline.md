# Native video pipeline migration (iOS)

Tracked work on `feat/player-native-video-pipeline`. Goal: replace
libmpv's GLES render path with `AVSampleBufferDisplayLayer`-fed
CVPixelBuffers while preserving every subtitle flavour we support.

## Why

libmpv's `vo=libmpv` + GLES interop ships two iOS-specific bugs:

1. **nv12 (8-bit) color matrix is wrong** — same bug the Rust port hit
   (commit 51fec4ba): straight `hwdec=videotoolbox` renders Titanic
   heavily green-tinted. Fixed only by forcing `-copy` (CPU readback).
2. **p010 (10-bit) is unsupported** — the GLES texture cache rejects
   p010 IOSurfaces outright; 10-bit HEVC falls back to a blue screen
   with audio.

The vendored libmpv exposes only `MPV_RENDER_API_TYPE_OPENGL` and
`MPV_RENDER_API_TYPE_SW` — no Metal/Vulkan render-context path. The
upstream mpv project doesn't ship a `libmpv_gpu_context_metal` either.
Net: **we cannot get mpv itself to render through Metal without
patching and rebuilding libmpv**. Feasible but a 4+ week detour; this
plan goes around the problem instead.

Cost of status quo (`-copy`): GPU→CPU readback + re-upload per frame.
Bounded, works, but forfeits native 10-bit HDR and Dolby Vision.

## Architecture

Three `CALayer` siblings on the player view:

```
  mpv core  (demux, decode, audio out, sub parsing — unchanged)
   │
   ├── hwdec=videotoolbox (zero-copy)
   │     └── CVPixelBuffer ─── AVSampleBufferDisplayLayer      [video layer]
   │
   ├── text sub engine (mpv internal)
   │     └── `sub-text` property observer ─── Core Text / libass
   │                                          └── CALayer      [text sub layer]
   │
   └── (bitmap subs not exposed by mpv)
         Parallel libavformat reader → libavcodec PGS/VobSub/DVB decoder
                                     └── Metal texture
                                          └── CALayer          [bitmap sub layer]
```

Video is consumed through `AVSampleBufferDisplayLayer` (already our
root layer — no teardown needed). Text subs are driven by mpv
property observers. Bitmap subs run through a sidecar ffmpeg context.

## Phased delivery

| #                | Scope                                                                                                 | Effort  | Ship gate                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| **0**            | `-copy` stays; plan tracked                                                                           | done    | main                                                        |
| **1**            | mpv `sub-text` observer → JS overlay; `sub-visibility=no` so JS overlay is the sole text-sub renderer | ~3 d    | Text subs render via JS overlay; mpv stops compositing subs |
| **2**            | AVSampleBufferDisplayLayer video + parallel VT decode, `video=no` in mpv                              | ~2 wk   | Flag-gated; zero-copy 8-bit + native 10-bit HDR             |
| **3**            | Parallel libavformat PGS/VobSub/DVB pipeline                                                          | ~1–2 wk | Bitmap subs restored on the new path                        |
| **4** (optional) | libass-backed text sub renderer                                                                       | ~1 wk   | Full ASS fidelity for anime content                         |

Minimum ship: 0–2 (~2.5 wk) with a flag fallback to `-copy` when a
bitmap sub track is selected. Full parity: 0–3 (~4 wk).

### Known regression on-branch

After Phase 1 landed `sub-visibility=no`, bitmap subtitle tracks
(PGS/VobSub/DVB — common on Blu-ray rips like Titanic) render as
nothing: mpv's `sub-text` property only fires for text codecs
(SRT/ASS/WebVTT/mov_text), and mpv is no longer compositing the
bitmap draw. This is the exact gap Phase 3 closes. The branch is
not shippable to main until either Phase 3 lands or we gate
`sub-visibility` per track codec.

## Sync model (Phase 2+)

Master clock = mpv's audio output (libmpv's `audio-pts`). Our
VideoToolbox decoder stamps CVPixelBuffers with PTS derived from that
clock. `CMTimebase` wiring from the PiP work already exists and
doesn't change.

## Risks

- **Parallel demux = 2× sub-stream HTTP** — negligible; sub streams
  are KB/s.
- **Seek drift** — the sidecar ffmpeg context seeks independently.
  Mitigated by pre-fetching subs ~500 ms ahead; stale-sub blip on seek
  is acceptable UX.
- **Auth-header parity** — validated. Jellyfin token rides in the
  stream URL's `api_key` query param (see `packages/api/src/playback.ts`
  for DirectPlay/Stream and the server-built `TranscodingUrl` for
  Transcode), so the sidecar open inherits auth for free. User-Agent
  is plumbed through `MpvLoadOptions.userAgent → currentUserAgent →
jf_bitmap_sub_open(user_agent=)` — the UA set on the mpv context is
  pinned to the ffmpeg context. Jellyfin stream endpoints don't
  require cookies, so no cookie jar needed.
- **HLS segment expiry** — both contexts follow the same manifest; not
  a correctness issue for VOD.

## Open decisions

- **Feature flag**: `ENABLE_NATIVE_VIDEO_PIPELINE`, default off during
  Phases 2–3, opt-in from settings.
- **Phase 4 priority** — depends on how ASS-heavy real user libraries
  are.
- **PiP** — Phase 2 keeps the existing PiP wiring (same layer, same
  `controlTimebase`), just changes who feeds frames.
