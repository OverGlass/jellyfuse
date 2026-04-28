# Phase 1 — Metal render rewrite (consumer Swift)

Paste the section below into a fresh Claude session to start Phase 1.
Everything the agent needs to know is in this file and the references it
points at — keeps the kickoff short.

---

## Prompt to paste

> Continuing the Polished Wolf player rewrite. Phase 0/0a/0b/0c and Phase 2
> are committed; Phase 1 is the remaining big piece: replace the GLES
> render path on iOS / Catalyst with `vo=gpu-next` driven through libplacebo
>
> - MoltenVK, writing into IOSurface-backed VkImages we sample as Metal
>   textures into an `AVSampleBufferDisplayLayer`. Picture-in-Picture must
>   keep working.
>
> Read these first:
>
> - `.claude/plans/i-want-to-do-polished-wolf.md` — canonical plan (Phase 1
>   section is the scope; AVSBDL-vs-AVPlayer rationale is the constraint).
> - `.claude/projects/-Users-antonincarlin-projects-jellyfuse/memory/MEMORY.md`
>   — load it in full. Especially these entries:
>   - `project_player_rewrite_decisions.md` — locked decisions
>   - `project_libmpv_no_vulkan_render_api.md` — why Phase 0c exists
>   - `project_ao_avfoundation_already_upstream.md` — Phase 2 background
> - `modules/native-mpv/docs/render-strategy-spike.md` — why we forked
> - `modules/native-mpv/docs/phase-1-starter-prompt.md` — this file's
>   "Implementation map" section below
> - `modules/native-mpv/src/NativeMpv.nitro.ts` — frozen JS contract; do
>   not change
> - `modules/native-mpv/ios/HybridMpvVideoView.swift` and
>   `HybridNativeMpv.swift` — current GLES code we are replacing /
>   modifying
>
> Then fork-side, read the Phase 0c API + body so you understand what the
> Swift is calling into:
>
> - `~/projects/mpv-apple/include/mpv/render_vk.h`
> - `~/projects/mpv-apple/include/mpv/render.h` (the
>   `MPV_RENDER_API_TYPE_VK` constant + `MPV_RENDER_PARAM_VULKAN_*` types)
> - `~/projects/mpv-apple/video/out/vulkan/libmpv_vk.c` — what mpv expects
>   the consumer to supply: `mpv_vulkan_init_params` (instance/phys-
>   device/device/queue) at create, `mpv_vulkan_target_image` (image/
>   format/dimensions/layout) per frame.
>
> Worktree is `feat/polished-wolf` at
> `~/projects/jellyfuse/.claude/worktrees/polished-wolf/`. The fork build
> for ios-arm64 + ios-sim already populates
> `modules/native-mpv/vendor/ios/libmpv-{device,simulator}/` via
> `scripts/fetch-libmpv.sh`. The podspec links the new XCFrameworks
> including MoltenVK + libplacebo. So when you run
> `bun run --filter @jellyfuse/mobile ios` your code is being linked
> against a real fork-built libmpv that exposes
> `MPV_RENDER_API_TYPE_VK` + `audio_out_avfoundation`. Phase 1 is purely
> consumer Swift — no fork patches expected.
>
> Goal: ship Phase 1 as a small set of focused commits on
> `feat/polished-wolf`. Do not finalise unless `bun run ios` actually plays
> a frame on simulator OR the user reports a real-device test result.
>
> Be honest about iteration: writing this in one shot then declaring done
> is the failure mode. Build, run, observe, fix.

## Implementation map

The plan section is `Phase 1 — Metal render rewrite (consumer)` in
`.claude/plans/i-want-to-do-polished-wolf.md`. The expected file set:

```
modules/native-mpv/ios/render/
├── MpvMetalView.swift            UIView { layerClass = AVSampleBufferDisplayLayer }
│                                  owns MTLDevice, MTLCommandQueue,
│                                  IOSurface-backed MTLTexture ring (N=3),
│                                  CADisplayLink, the render dispatch queue.
├── MpvVulkanBridge.swift+.mm     MoltenVK init: VkInstance/VkPhysicalDevice/
│                                  VkDevice/VkQueue creation. Imports each
│                                  ring IOSurface as a VkImage via
│                                  VK_EXT_metal_objects (preferred) or
│                                  vkUseIOSurfaceMVK (fallback).
├── MpvRenderContext.swift        Wraps mpv_render_context_create with
│                                  MPV_RENDER_API_TYPE_VK + a
│                                  mpv_vulkan_init_params built from the
│                                  bridge. Owns the update callback +
│                                  schedules render() on the render queue.
└── MpvSampleBufferEnqueuer.swift Per-frame: mpv_render_context_render
                                   into ring[i].VkImage; CVPixelBuffer wrap
                                   of ring[i].IOSurface;
                                   CMSampleBufferCreateForImageBuffer with
                                   the correct PTS pulled from CMTimebase;
                                   AVSampleBufferDisplayLayer.enqueue.
```

Modifications to existing files:

- `HybridMpvVideoView.swift` — keep `attachPlayer/detachPlayer` API
  unchanged. Replace the existing `MpvGLView` body with
  `MpvMetalView`. Keep the CMTimebase setup + AVPictureInPictureController
  wiring; that part is still correct.
- `HybridNativeMpv.swift` — change the mpv option block:
  - drop `vid=no` and `pause=yes` (lifecycle reorder: mpv_create →
    mpv_initialize → wait for `attachPlayer` → `load`)
  - drop `hwdec=videotoolbox-copy`, replace with `hwdec=videotoolbox`
    (true zero-copy)
  - drop `vo=libmpv`, replace with `vo=gpu-next`, plus
    `gpu-api=vulkan`
  - drop the `os_unfair_lock` for `needsRender` — render-queue
    serialization replaces it
- `NativeMpv.podspec` — the Metal/MetalKit/IOSurface frameworks are
  already linked (committed in Phase 0b); no further changes needed.

Behind a Swift compile flag `MPV_USE_METAL_RENDERER` so the new path
can be merged before all simulator/Catalyst kinks are resolved.

## Sequence I'd suggest

1. **Read first.** Fork's `libmpv_vk.c` is short; it tells you exactly
   what shape of `mpv_vulkan_init_params` is expected. The agent
   shouldn't propose Vulkan/MoltenVK plumbing without confirming the
   contract.
2. **Spike `MpvVulkanBridge` standalone.** Build a tiny Swift file
   that just initialises MoltenVK + creates a VkInstance/Device, and
   wraps a single IOSurface as a VkImage. Run it from a unit test or
   a `print()` in a fresh hook. If this works the rest is mechanical.
3. **`MpvMetalView` next.** It's the UIKit container — straight Metal,
   no Vulkan involved. AVSampleBufferDisplayLayer + CADisplayLink + ring
   of MTLTextures backed by IOSurfaces. Should be reusable as-is when
   Phase 1 lands.
4. **`MpvRenderContext` + `MpvSampleBufferEnqueuer`.** Wire mpv into
   the bridge + view. First success criterion: `mpv_render_context_render`
   returns 0 (not `MPV_ERROR_NOT_IMPLEMENTED`, not a Vulkan validation
   error). At this point you'll see frames in the IOSurface even if the
   AVSBDL display path has bugs.
5. **AVSBDL enqueue.** Wrap → CVPixelBuffer → CMSampleBuffer → enqueue.
   Watch for: PTS off the CMTimebase, color attachments on the format
   description (BT.709 for SDR), `requestMediaDataWhenReady`. PiP
   should still work since AVSBDL hasn't changed.
6. **Drop the old code.** `MpvGLView` and the `vid=no`/`pause=yes`
   workaround go away. Keep the file in git history for reference but
   don't keep the dead code in the tree (CLAUDE.md rule).

## Known landmines

- **`VK_EXT_metal_objects` vs `vkUseIOSurfaceMVK`.** The newer
  `_metal_objects` extension is the official path for IOSurface ↔
  VkImage on Apple platforms; it requires MoltenVK 1.2.4+ (we ship
  1.4.1). The older `vkUseIOSurfaceMVK` works on any version but is
  going to be deprecated. Try `_metal_objects` first; fall back if
  the simulator doesn't expose it.
- **VkImage usage flags must match what libplacebo expects.**
  `pl_vulkan_wrap` uses `usage` to determine which `pl_tex` capabilities
  to expose. The fork's libmpv_vk.c passes
  `COLOR_ATTACHMENT|TRANSFER_DST|TRANSFER_SRC|SAMPLED`; the IOSurface-
  backed VkImage must be created with the same set or `pl_vulkan_wrap`
  fails with no useful error.
- **Lifecycle reorder.** Today's code starts mpv with `vid=no`/
  `pause=yes` because the render context isn't ready. Phase 1 reverses
  this: `mpv_create` → `mpv_initialize` (without loading) → app calls
  `attachPlayer` which builds the render context → app calls `load(url)`.
  The JS contract already gates `load()` on the screen mounting, so the
  ordering is enforceable.
- **`CADisplayLink` should not call mpv directly.** Set a
  `pendingRender` atomic flag; the dedicated render queue runs
  `mpv_render_context_render` once per vsync window. Don't reintroduce
  the `os_unfair_lock` we just removed.
- **Color attachments on `CMSampleBuffer`.** For SDR BT.709 the
  CMFormatDescriptionExtension keys are `_ColorPrimaries =
ITU_R_709_2`, `_TransferFunction = ITU_R_709_2`, `_YCbCrMatrix =
ITU_R_709_2`. Phase 3 will switch to `ITU_R_2020` + PQ/HLG for HDR,
  but make sure the SDR case is right first.
- **Catalyst caveat.** MoltenVK on Mac Catalyst exposes most of what
  iOS does, but some `VK_EXT_metal_objects` features behave differently.
  If Catalyst is failing while iOS works, suspect this first.

## Success criteria

A Phase 1 commit is shippable when ALL of these hold:

1. SDR H.264 1080p file plays end-to-end on iOS Simulator (arm64
   Mac) without artifacts.
2. HDR10 HEVC 10-bit file plays without color clipping (BT.2020 + PQ
   honoured by libplacebo's tone-mapping default).
3. Picture-in-Picture enter/exit works; scrubber reflects playhead.
4. argent-react-native-profiler shows ≥30% lower per-frame CPU than
   the existing GLES build on the same fixture (the `videotoolbox-copy`
   readback was the dominant cost).
5. No `os_unfair_lock`, no `vid=no`/`pause=yes`, no
   `hwdec=videotoolbox-copy` in the codebase.

If any of those fail, that's a known follow-up, not a "Phase 1 done."
