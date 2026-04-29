# Phase 1B — Path B: vo=gpu-next via a headless ra_ctx

**Status:** Active. Path B selected over Path A on maintenance grounds (see
`render-strategy-spike.md` for the decision matrix that _originally_
selected Path A; this doc supersedes it for Phase 1B).

**Owner:** rendering / native-mpv

**Predecessors:** Phase 0a/0b (fork + build), Phase 0c (libmpv render-API
patch), Phase 1A (consumer wire-up against render-API). Phase 1A demonstrated
that MoltenVK + libplacebo + glslang come up cleanly on real device, but
mpv's render-API path goes through `gl_video`, not `pl_renderer` — so what
ships isn't actually `vo=gpu-next` quality. Path B replaces the render-API
approach with a custom `ra_ctx` so `vo=gpu-next` runs end-to-end against
externally-supplied IOSurface-backed VkImages.

## Why Path B over Path A

|                           | Path A                                    | Path B                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial fork LOC          | ~850                                      | ~300                                                                                                                                                                                            |
| Initial libplacebo LOC    | 0                                         | ~250-350                                                                                                                                                                                        |
| Vo_gpu_next changes       | Parallel implementation (we re-implement) | None — runs unmodified                                                                                                                                                                          |
| Upstream mpv churn        | Manual port forever                       | Free                                                                                                                                                                                            |
| Upstream libplacebo churn | Hits two places                           | Small patch surface                                                                                                                                                                             |
| Upstreamability           | Hard                                      | The headless swapchain is genuinely useful to other libplacebo consumers (game capture, video editors, server-side renderers). Realistic chance of upstream acceptance → eventually zero patch. |
| Steady-state complexity   | Permanently elevated                      | Low                                                                                                                                                                                             |

Path A is faster to first working frame; Path B is the engineering choice.

## What is being deleted

Phase 1A consumer code mostly goes away. We keep the AVSBDL display half;
we drop the Vulkan-on-the-Swift-side plumbing, since the new `ra_ctx`
brings up MoltenVK on the C side.

| File                                                          | Phase 1B fate                                                                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `modules/native-mpv/ios/render/MpvVulkanBridge.swift`         | **Delete.** VkInstance/Device/Queue setup moves into `video/out/vulkan/context_libmpv.c` (fork).                      |
| `modules/native-mpv/ios/render/MpvRenderContext.swift`        | **Delete.** No more `mpv_render_context_create` — vo=gpu-next drives mpv itself.                                      |
| `modules/native-mpv/ios/render/MpvSampleBufferEnqueuer.swift` | Keep (small, focused, still useful).                                                                                  |
| `modules/native-mpv/ios/render/MpvMetalView.swift`            | **Trim heavily.** Keep AVSampleBufferDisplayLayer + IOSurface ring management + PiP wiring; drop everything Vulkan.   |
| `modules/native-mpv/ios/HybridMpvVideoView.swift`             | Keep, simplified.                                                                                                     |
| `modules/native-mpv/ios/HybridNativeMpv.swift`                | Keep — drop `attachPlayer`-gated lifecycle (no longer needed); set `vo=gpu-next gpu-api=vulkan gpu-context=libmpvvk`. |

## Architecture

```
┌───────────────────── consumer (Swift / iOS) ─────────────────────┐
│                                                                  │
│  MpvMetalView (UIView, layerClass = AVSBDL)                      │
│  ├─ owns IOSurface ring (N=3, BGRA or 16F per HDR mode)          │
│  ├─ exposes acquire() / present() via Nitro callbacks            │
│  └─ feeds CMSampleBuffer to AVSBDL on present()                  │
│                                                                  │
└──────────────────────────────────┬───────────────────────────────┘
                                   │ JS-thread callback bridge
                                   │  (acquire next free idx,
                                   │   submit frame idx N)
┌──────────────────────────────────▼───────────────────────────────┐
│                                                                  │
│  fork: video/out/vulkan/context_libmpv.c   (NEW, ~250 LOC)       │
│  ├─ mpvk_init(no surface) + VkDevice with required features      │
│  ├─ pl_vulkan_create_headless_swapchain(...) ← libplacebo patch  │
│  └─ ra_ctx_fns = { init, uninit, reconfig, control }             │
│                                                                  │
│  fork: libplacebo (NEW PUBLIC API, ~250-350 LOC)                 │
│  └─ pl_vulkan_create_headless_swapchain(vk, params)              │
│       params { num_images, images[], wxh, format, color,         │
│                acquire, present, priv }                          │
│                                                                  │
│  vo_gpu_next.c (UNCHANGED)                                       │
│  └─ runs through standard pl_swapchain_start_frame /             │
│     submit_frame / swap_buffers, indistinguishable from         │
│     a real swapchain                                             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

The headless swapchain is the new thing. Its job is the moral equivalent
of `pl_vulkan_create_swapchain`, just sourcing images from a user-supplied
pool instead of `vkAcquireNextImageKHR`. From `vo_gpu_next`'s perspective,
nothing changes.

## Audit highlights (concrete file:line citations)

These come from a structured audit of the fork + vendored libplacebo. Key
findings:

- `vo_gpu_next.c` reaches into the swapchain via three paths:
  `pl_swapchain_colorspace_hint(p->sw, hint)` (`vo_gpu_next.c:1026`),
  `pl_swapchain_start_frame(p->sw, &swframe)` (`:1269`),
  `pl_swapchain_submit_frame(p->sw)` (`:1494`). All three need real
  implementations in our headless variant.
- `gpu_ctx_create` short-circuits at `gpu_next/context.c:117-124` when
  `ra_vk_ctx_get(ctx->ra_ctx)` returns non-NULL. So as long as our
  ra_ctx populates `mpvk_ctx->{pllog, gpu, swapchain}`, vo_gpu_next
  picks it up unmodified.
- `pl_sw_fns` (`libplacebo/src/swapchain.h:28-38`) is the contract our
  headless swapchain must implement. Mandatory: `destroy`, `start_frame`,
  `submit_frame`, `swap_buffers`. Optional: `latency`, `resize`,
  `colorspace_hint`.
- Existing precedent for "user-supplied VkImage as pl_tex": `pl_vulkan_wrap`
  (`include/libplacebo/vulkan.h:475-528`). Our headless swapchain wraps
  each user-supplied VkImage with this exact API at create time.
- mpv's existing `pl_swapchain` impl in `vulkan/swapchain.c` defers actual
  swapchain creation to first `start_frame` → `vk_sw_recreate` (`:847`)
  with retired-pool plumbing. **Our headless variant has no reason to
  defer** — images are user-supplied at create time. This is one of the
  ways the headless impl is genuinely simpler than the surface-bound one.
- Mandatory `ra_ctx_fns` members: `init`, `uninit`, `reconfig`, `control`,
  plus `name`/`type`/`description`. Optional: `wakeup`, `wait_events`,
  `update_render_opts`. Skipped by `context_android.c` and
  `context_display.c`.
- ra_ctx registration: `gpu/context.c:78-136` `contexts[]` array; meson
  gating at `meson.build:1328-1339`.

## Public API design — `pl_vulkan_create_headless_swapchain`

```c
struct pl_vulkan_headless_swapchain_params {
    int            num_images;     // size of the user-supplied pool
    VkImage       *images;         // user-allocated, IOSurface-backed
    VkFormat       format;
    int            width, height;
    VkImageUsageFlags usage;       // must include COLOR_ATTACHMENT|TRANSFER_DST|SAMPLED
    struct pl_color_repr  color_repr;
    struct pl_color_space color_space;
    int            swapchain_depth; // default 2; vo_gpu_next reads this for backpressure

    // Called from submit_frame after libplacebo has finished writing.
    // sem_wait fires when image_idx is GPU-ready for the consumer to
    // display. The consumer is responsible for vkWaitSemaphore + the
    // platform-specific present (e.g. AVSampleBufferDisplayLayer enqueue).
    void (*present)(void *priv, int image_idx, pl_vulkan_sem sem_wait);

    // Called from start_frame when libplacebo wants the next image.
    // Consumer signals sem_signal when the chosen image is free for
    // libplacebo to write into. Return false to tell vo_gpu_next "no
    // image available, drop this frame" (matches the wayland convention).
    bool (*acquire)(void *priv, int *out_image_idx, pl_vulkan_sem sem_signal);

    void *priv;
};

PL_API pl_swapchain pl_vulkan_create_headless_swapchain(
    pl_vulkan vk, const struct pl_vulkan_headless_swapchain_params *params);
```

Lifecycle: identical to `pl_vulkan_create_swapchain` — `init` →
`start_frame`/`submit_frame` pairs → `resize` (= destroy and recreate with
a new image pool) → `destroy`.

Threading: same per-swapchain mutex held start→submit
(`vulkan/swapchain.c:841,909,952` precedent). Cross-thread access from the
consumer's CADisplayLink/AVSBDL thread goes through the
`acquire`/`present` callbacks + `pl_vulkan_sem` — never direct
`pl_swapchain` calls. This is exactly what `pl_vulkan_hold_ex` /
`pl_vulkan_release_ex` (already in libplacebo) are designed for.

## Implementation steps

The work splits cleanly along the three boundaries: libplacebo, fork
ra*ctx, consumer Swift. Each step ends with a test that \_can* be run
without the next step landing, so we keep the working build bisectable.

### Step 1 — libplacebo: `pl_vulkan_create_headless_swapchain`

**Files:** `src/include/libplacebo/vulkan.h` (public decl),
`src/vulkan/swapchain.c` (impl alongside the existing one), maybe a new
`src/vulkan/swapchain_headless.c` if the existing file gets too large.

**Approach:** Copy the structural skeleton from `pl_vulkan_create_swapchain`
— priv struct begins with `struct pl_sw_fns impl;`, mutex, `swapchain_depth`,
images array. Replace the surface-bound bits:

- `pick_surf_format` → drop entirely; format is `params->format`.
- `vkCreateSwapchainKHR` / retired-pool plumbing → drop.
- `vkAcquireNextImageKHR` in `start_frame` → call `params->acquire` callback.
- `vkQueuePresentKHR` in `submit_frame` → call `params->present` callback;
  use `pl_vulkan_hold_ex` to transition layout before the callback.
- `colorspace_hint` → no-op for v1 (consumer told us the color space at
  create time; mpv calling this is just informational).
- `resize` → destroy existing pl_tex wrappers, return false (consumer
  must rebuild the swapchain with a fresh pool).

Each user-supplied VkImage is wrapped via `pl_vulkan_wrap` at create time
(`vulkan/swapchain.c:667-674` is the existing precedent in the surface
swapchain).

**LOC budget:** ~250 lines new (mostly direct copies from the existing
swapchain with surface-bound logic excised).

**Verification standalone:** Add a tiny `pl_vulkan_create_headless_swapchain`
unit test under `libplacebo/tests/` that drives a 2-image pool through
start/submit/swap and asserts the right images come back. Doesn't need
mpv at all.

### Step 2 — fork ra_ctx: `video/out/vulkan/context_libmpv.c`

**Files:** new `video/out/vulkan/context_libmpv.c` (~250 LOC), edits to:

- `video/out/gpu/context.c` — add `extern` + `&ra_ctx_vulkan_libmpv` to `contexts[]`.
- `meson.build` — gate the new file behind a feature flag (`vulkan-libmpv-render` or similar; default-on for Apple platforms, off elsewhere).

**Approach:** mimic `context_android.c` (the closest analog — 104 lines,
no NSApp/NSWindow nonsense). Differences:

```c
struct priv {
    struct mpvk_ctx vk;
    // pool state — passed in via mpv property or set_parameter
    int num_images;
    VkImage *images;
    int width, height;
    VkFormat format;
    // callback bridge to consumer (Swift side via Nitro)
    void *consumer_priv;
    bool (*acquire)(void *, int *, pl_vulkan_sem);
    void (*present)(void *, int, pl_vulkan_sem);
};
```

`init`:

1. `mpvk_init(vk, ctx, NULL)` — no surface extension.
2. `mppl_create_vulkan(vk, ...)` — VkDevice with `VK_KHR_external_memory`,
   `VK_EXT_metal_objects`, `VK_EXT_external_memory_metal`, plus
   `VK_KHR_external_semaphore` + `VK_KHR_external_semaphore_capabilities`
   for the MTLSharedEvent ↔ VkSemaphore bridge.
3. Acquire image pool from a new mpv option or render-param channel.
4. Build `pl_vulkan_headless_swapchain_params`, call our new API.
5. Set `mpvk_ctx->swapchain` so `gpu_ctx_create` picks it up.

`reconfig`: when image dimensions change, tear down + rebuild swapchain
(consumer rebuilds IOSurface pool first).

`control`: handle `VOCTRL_VO_OPTS_CHANGED` (pass to `pl_swapchain` if
relevant), otherwise `VO_NOTIMPL`.

**LOC budget:** ~250 lines.

**Image pool / callback delivery.** The fork ra_ctx and the Swift consumer
need a channel to share the IOSurface VkImage pool + callbacks. Options:

1. **mpv render-API parameters** — add new `MPV_RENDER_PARAM_*` constants.
   Clean but requires consumers to call `mpv_render_context_create` —
   which we just decided to drop.
2. **mpv `set_property` with custom keys** — string-based, hacky for
   pointers.
3. **Direct C function calls from the consumer to a fork-side registry**
   — `extern void mpv_libmpv_set_image_pool(mpv_handle *, …);` declared
   in `mpv/render_libmpv_apple.h` (new header). Consumer Swift calls it
   before `vo_create`.

Option 3 is the cleanest; we own the consumer + the fork. Document the
ABI in a new `mpv/render_libmpv_apple.h` header. Sketch:

```c
// mpv/render_libmpv_apple.h — fork extension

typedef struct mpv_libmpv_apple_pool_params {
    int num_images;
    VkImage *images;
    int width, height;
    VkFormat format;

    bool (*acquire)(void *priv, int *out_idx, pl_vulkan_sem sig);
    void (*present)(void *priv, int idx, pl_vulkan_sem wait);
    void *priv;
} mpv_libmpv_apple_pool_params;

MPV_EXPORT int mpv_libmpv_apple_set_pool(
    mpv_handle *ctx, const mpv_libmpv_apple_pool_params *params);
```

Internally the call routes to a global registry keyed on `mp_client_api`,
read by `context_libmpv.c` during `init`.

**Verification standalone:** with libplacebo Step 1 and the consumer Step
3 stubbed (just allocates a dummy 2-image VkImage pool), a test program
can drive `vo_create("gpu-next") → vo_render_frame → flip_page` and watch
images cycle through `acquire`/`present` callbacks. No real display
required.

### Step 3 — consumer pivot

**Delete:** `MpvVulkanBridge.swift`, `MpvRenderContext.swift`.

**Rewrite slim:** `MpvMetalView.swift` keeps the AVSBDL + IOSurface ring,
loses the Vulkan code. Add a small bridging callback type:

```swift
final class MpvMetalView: UIView {
    // … unchanged AVSBDL/PiP plumbing …

    // IOSurface pool — reused on every frame.
    private var ring: [(IOSurfaceRef, VkImage, CVPixelBuffer)] = []

    // Called from libmpv (via a Nitro-bridged C callback) on the
    // mpv render thread. Returns the next free slot index.
    func acquire(out idx: UnsafeMutablePointer<Int32>,
                 signal sem: vk_sem_t) -> Bool {
        // pop free slot, signal sem when GPU work can write into it
    }

    // Called from libmpv on submit. We wait on `sem` then enqueue
    // the IOSurface as a CMSampleBuffer to AVSBDL on main.
    func present(idx: Int32, wait sem: vk_sem_t) {
        // schedule MTLSharedEvent wait → enqueue → mark slot free
    }
}
```

The `VkImage` allocation stays in the consumer (we own the IOSurfaces).
After Phase 1B Step 2 lands the fork extension, the consumer also calls
`mpv_libmpv_apple_set_pool` after `mpv_create` and before `loadfile`.

**HybridNativeMpv.swift mpv option block:**

```swift
mpv_set_option_string(mpv, "vo", "gpu-next")
mpv_set_option_string(mpv, "gpu-api", "vulkan")
mpv_set_option_string(mpv, "gpu-context", "libmpvvk")
mpv_set_option_string(mpv, "hwdec", "videotoolbox")
```

**Verification:** the integration test. SDR H.264 plays end-to-end on
real device. Then HDR10. Then PiP enter/exit.

## Coding standards

This patch lands in two upstream-class projects. We code accordingly:

- **libplacebo:** match the existing C99 style — 4-space indent, snake*case,
  K&R braces, `pl_log*\_`for diagnostics,`pl\_\_\_destroy`for cleanup,`talloc`-free zero-init style with explicit `pl_alloc`/`pl_free`. Every
public API gets a Doxygen-style header comment matching the existing
ones in `vulkan.h`. Memory ownership is explicit ("owned by the user"
vs "owned by the swapchain"). Errors via `bool`return +`PL_ERR` log.
- **mpv:** match `video/out/vulkan/context_*.c` — `talloc_zero` for priv,
  `MP_ERR/MP_VERBOSE/MP_FATAL` for diagnostics, `goto error;` style
  cleanup, K&R braces. Every static function with a non-obvious
  invariant gets a one-line comment.
- **No dead code, no scaffolding.** Functions land wired end-to-end or not
  at all. Per project CLAUDE.md.
- **Comments explain _why_, not _what_.** "Skip surface dance because
  we're headless" not "create swapchain".
- **Public API stability.** `mpv_libmpv_apple_set_pool` ABI is documented
  with a version constant in the header. Bumping it requires a fork minor
  version.

## Test plan

| Phase  | Test                                                                                                                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 1 | Add `tests/headless_swapchain.c` to libplacebo: 2-image pool, drive 10 frames, assert acquire/present callback order.                                                               |
| Step 2 | mpv unit: vo=gpu-next gpu-context=libmpvvk + a stub pool that fills VkImages with solid colors; assert the colors come back through the present callback.                           |
| Step 3 | Real device: SDR H.264 1080p plays; HDR10 HEVC 10-bit plays without color clipping; PiP enter/exit works; `argent-react-native-profiler` shows no per-frame regression vs Phase 1A. |

## Risks tracked

1. **HDR colorspace hint negotiation in headless mode.** AVSBDL needs
   color attachments on the CMSampleBuffer to match what we tell
   libplacebo. If they drift, we get washed-out or banded output. Walk
   through this with an HDR10 test fixture in Step 3.
2. **MoltenVK on iOS may not expose `VK_KHR_external_semaphore` with
   `MTLSHAREDEVENT_BIT`.** Verify before committing to the
   `pl_vulkan_sem`-based bridge. Fallback: host-side fence wait —
   stalls the JS thread, but works.
3. **`swapchain-maintenance1` may be absent on MoltenVK.** The
   surface-bound swapchain falls back to `vkQueueWaitIdle` per resize
   (`vulkan/swapchain.c:471-479`). For headless we can skip this branch
   entirely — verify in Step 1.
4. **`VK_KHR_swapchain` device extension.** We don't enable it on the
   headless device (no surface), but `pl_vulkan_create` may still try.
   Verify the no-surface path through `mppl_create_vulkan`.
5. **`pl_swapchain.colorspace_hint`** triggers a swapchain rebuild on
   real Vulkan. We no-op it for v1; if vo*gpu_next ends up \_requiring*
   a rebuild on SDR↔HDR transitions to update the IOSurface format,
   add a callback path "colorspace hint changed → consumer rebuilds
   pool → resize."
6. **VkImage usage flags.** libplacebo's `pl_vulkan_wrap` requires the
   image to have been created with usage flags matching what it'll do.
   We must enforce `COLOR_ATTACHMENT | TRANSFER_DST | SAMPLED` on the
   consumer side (we already do — Phase 1A `MpvVulkanBridge.swift`
   `makeImageFromIOSurface`).

## Reference implementations consulted

- `libplacebo/src/vulkan/swapchain.c` — the canonical pl_swapchain impl
  we're cloning the structure of.
- mpv `video/out/vulkan/context_android.c` — the closest existing
  "minimal" ra_ctx (no NSApp/NSWindow). Our context_libmpv.c is shaped
  like this.
- Phase 1A `MpvVulkanBridge.swift` — the IOSurface-to-VkImage import
  pattern via `VK_EXT_metal_objects` we keep using.
- `pl_dummy.h` (libplacebo) — precedent for a swapchain-less pl_gpu use
  case. Demonstrates that libplacebo accepts non-presentation backends.
- `pl_vulkan_wrap` (`libplacebo/include/libplacebo/vulkan.h:475-528`) —
  the exact API for "user-supplied VkImage as pl_tex." Inside the new
  swapchain's `init`, we call this once per image in the pool.

## Out of scope for Phase 1B

- Frame interpolation (`tscale`/`interpolation`) — not in the v1 product;
  defer to a later phase.
- ICC profile loading — defer.
- Custom shader hooks (`--glsl-shader`) — defer.
- Dolby Vision — already deferred per HDR scope v2.

These all already work in `vo_gpu_next` and will light up automatically
when the user enables them; we just don't ship UI for them.

## Definition of done

A Phase 1B commit is shippable when ALL of these hold:

1. SDR H.264 1080p file plays end-to-end on iOS device without artifacts.
2. HDR10 HEVC 10-bit file plays without color clipping (BT.2020 + PQ
   honoured by libplacebo's tone-mapping default).
3. Picture-in-Picture enter/exit works; scrubber reflects playhead.
4. **No CPU/power regression** on `argent-react-native-profiler` for SDR
   H.264 1080p sustained playback measured against Phase 1A (which is the
   right baseline; the ≥30% Phase 0→Phase 1 reduction in the original
   starter prompt was driven by dropping `videotoolbox-copy`'s CPU
   readback, and that change already landed in Phase 1A — Path B's
   delta is GPU-side renderer quality, not CPU).
5. **HDR10 tone-mapping visually matches a desktop `mpv --vo=gpu-next`
   reference render** of the same fixture (side-by-side screenshot
   comparison; numeric thresholds aren't useful for tone-mapping).
6. Optional perf bonus: GPU frame-time stays under 16.6ms at 1080p and
   under 33.3ms at 4K30, measured via `pl_dispatch_info` (libplacebo's
   per-pass timing) or an Instruments GPU capture.
7. No dead code: `MpvVulkanBridge.swift`, `MpvRenderContext.swift` deleted;
   no stub functions; no `// TODO wire up` comments.
8. fork patch is upstream-ready: small diff against `apple/main`,
   conventional-commit messaged, no ifdef-soup.
9. libplacebo patch is upstream-ready (PR-able): one new public API,
   one new internal file or addition, public header doc'd, unit test
   landed.
