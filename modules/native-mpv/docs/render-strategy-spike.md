# Phase 1 spike — render strategy

**Date:** 2026-04-28
**Status:** Open — needs decision before Phase 1 implementation
**Plan reference:** `.claude/plans/i-want-to-do-polished-wolf.md`

## TL;DR

The plan as written assumes `MPV_RENDER_API_TYPE_VK` exists. It doesn't.

```c
// mpv/render.h (libmpv 0.41.0)
#define MPV_RENDER_API_TYPE_OPENGL "opengl"
#define MPV_RENDER_API_TYPE_SW     "sw"
```

That's the entire render API surface. No Vulkan, no Metal, no DRM-direct. mpv's `vo=gpu-next` exists _internally_ and uses libplacebo with a Vulkan backend, but it owns its own surface — there's no public hook to plug in our own externally-managed `VkImage`.

The 2-day spike is short-circuited: the question "(a) `--gpu-context=offscreen-vulkan` patch, or (b) drive libplacebo directly via the libmpv render API" doesn't have answer (b) — there is no Vulkan render API to drive.

The honest option space is:

|     | Option                                                               | Forks libmpv?                          | PiP works?                                                             | HDR via libplacebo?                     | iOS+Catalyst unified?                                                      | Effort                                     |
| --- | -------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| A   | **Add `MPV_RENDER_API_TYPE_VK` to our fork**                         | Yes (new patch alongside the AO patch) | Yes (we feed AVSBDL)                                                   | Yes                                     | Yes                                                                        | ~5 days mpv internals + the plan's Phase 1 |
| B   | Keep `MPV_RENDER_API_TYPE_OPENGL`, mpv internally uses libplacebo+GL | No (consumer-side cleanup only)        | Yes (current path)                                                     | Yes (libplacebo runs on GL backend too) | No — GLES on iOS, desktop GL on Catalyst (deprecated), separate code paths | ~Phase 1 minus the fork patch              |
| C   | `--wid` embedding, mpv owns a `CAMetalLayer` swapchain               | No                                     | **No** — AVSBDL not in the loop, PiP is `AVPlayerLayer`-or-AVSBDL only | Yes                                     | Yes                                                                        | Smallest, but kills PiP                    |
| D   | `MPV_RENDER_API_TYPE_SW` + GPU upload                                | No                                     | Yes                                                                    | Manual (CPU shader)                     | Yes                                                                        | Real-time HDR is impractical               |

## Why I'd recommend Option A

The decision matrix from the original plan locked in:

- **Hard fork** — already approved.
- **Metal-native, single path for iOS + Catalyst + tvOS** — Option B fails this (GLES on iOS, desktop GL on Catalyst, separate compile branches forever).
- **PiP works** — Option C fails this.
- **HDR via libplacebo** — Options A, B, D all qualify.

Option A is the only one that satisfies all four. We're forking for the AO already; adding a render API patch is the second patch in the same fork — same maintenance overhead, more value extracted from it.

## What Option A actually entails

A self-contained mpv patch series:

1. **`video/out/render/render_vk.{c,h}`** (new). Mirrors the shape of `render_gl.c` — wires `mpv_render_context`'s frame production into mpv's existing `video/out/vulkan/` backend, but with the swapchain replaced by an externally-supplied VkImage we own.

2. **`mpv/render.h`** — add `MPV_RENDER_API_TYPE_VK` constant + `mpv_vulkan_init_params` struct (`get_proc_address`, `get_proc_address_ctx`, optionally pre-created `VkInstance`/`VkPhysicalDevice`/`VkDevice` so we share with our MoltenVK setup) + `MPV_RENDER_PARAM_VK_TARGET_IMAGE` parameter type for the render target.

3. **`video/out/gpu_next.c`** — small change: when the render context is Vulkan, target the supplied VkImage instead of creating a swapchain.

4. **`wscript`** — guard the new file with `--enable-vulkan-render-api`, default-on for Apple platforms.

Risk surface:

- Patch needs to land cleanly on `apple/main` and rebase on upstream — mpv's render code is moderately stable but does shift. Mitigation: small, well-isolated patch, kept under 500 LOC.
- Open-source upstreaming opportunity — this is something multiple projects have wanted. Consider proposing it to mpv-player after it's working. Reduces our long-term rebase tax.

Consumer-side then matches the original Phase 1 design unchanged: `MpvVulkanBridge` brings up MoltenVK + creates the VkInstance/Device, imports IOSurfaces as VkImages via `VK_EXT_metal_objects`, calls `mpv_render_context_create` with `MPV_RENDER_API_TYPE_VK` + the externally-created Vulkan handles, then `mpv_render_context_render` writes into our IOSurface, which we wrap as `CMSampleBuffer` for AVSBDL.

## What changes vs the approved plan

The plan said Phase 1 was Swift-only. With Option A, Phase 1 is **Swift + a libmpv render-API patch in the fork**. Net effort goes from "Swift rewrite" to "Swift rewrite + ~3-5 days of mpv internals". Phase ordering also shifts: the render-API patch is a Phase 0c (lands in the fork before Phase 1 consumer-side work starts), not a Phase 1 task.

Updated phase order (proposed):

| #      | Phase                                | Notes                                                                        |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------- |
| 0a     | Fork repo + build infra              | Unchanged                                                                    |
| 0b     | Consumer fetch + podspec             | Unchanged                                                                    |
| **0c** | **mpv render-API VK patch (new)**    | **Lands in the fork. Output: libmpv that exposes `MPV_RENDER_API_TYPE_VK`.** |
| 1      | Metal render rewrite (consumer side) | Unchanged in scope, now depends on 0c                                        |
| 2      | Custom AO                            | Unchanged                                                                    |
| 3      | HDR10 + HLG                          | Unchanged                                                                    |
| 4      | Cleanup                              | Unchanged                                                                    |
| 5      | AirPlay video spike                  | Unchanged                                                                    |

## Alternatives considered and rejected

- **Option B (OpenGL render API)**: works, but iOS+Catalyst stay on different render paths (GLES vs desktop GL on Catalyst). The single-path-everywhere benefit is half the reason the user said yes to a Metal rewrite. Also, GLES has the `videotoolbox-copy` color/format issues we're trying to leave behind.
- **Option C (`--wid`)**: smallest code, but loses PiP. PiP is a hard product requirement (lock-screen + multitasking are baseline for a media app on iPad).
- **Option D (SW)**: not viable for HDR or 4K.

## Next steps

1. User signs off on Option A (this doc).
2. Phase 0c added to the task list, blocking Phase 1.
3. Plan file updated to reflect the new ordering + the render API patch.
4. Phase 0a continues in parallel (fork repo scaffolding doesn't depend on the patch landing).
