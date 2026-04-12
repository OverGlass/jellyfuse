# @jellyfuse/native-mpv

iOS Nitro module wrapping [MPVKit](https://github.com/mpvkit/MPVKit) v0.41.0 — the prebuilt libmpv + FFmpeg + codec dep stack the Rust Jellyfusion desktop/iOS build has shipped in production since commit `26cf8114`.

This module is the backbone of Phase 3. Phase 3a (this directory) ships the audio-only hybrid object + listener plumbing and the MPVKit vendor script. Phase 3b adds the Fabric `MpvView` with an `mpv_render_context` on top — see `modules/native-mpv/VIDEO.md` (not yet written).

## Layout

```
modules/native-mpv/
├── package.json               @jellyfuse/native-mpv workspace package
├── nitro.json                 Nitrogen config (iOS module name, autolinking hooks)
├── NativeMpv.podspec          CocoaPods spec vendoring MPVKit static libs
├── src/
│   ├── NativeMpv.nitro.ts     Hybrid object TS spec — Nitrogen generates Swift from this
│   └── index.ts               JS-side public entry (createNativeMpv)
├── ios/
│   └── HybridNativeMpv.swift  Swift impl conforming to the Nitrogen-generated protocol
├── scripts/
│   └── fetch-mpvkit.sh        Downloads MPVKit XCFrameworks into vendor/ios/mpvkit-{device,simulator}
└── vendor/ios/
    ├── mpvkit-device/         → ~/Library/Caches/jellyfuse/mpvkit-ios/$VER/device
    └── mpvkit-simulator/      → ~/Library/Caches/jellyfuse/mpvkit-ios/$VER/simulator
```

## One-time setup

```sh
# From the monorepo root. Downloads ~200 MB of XCFrameworks on
# first run into a shared cache at ~/Library/Caches/jellyfuse.
# Subsequent runs just relink the per-worktree symlinks.
bun run --filter @jellyfuse/native-mpv fetch-mpvkit

# Generates the Swift protocol + Kotlin interface + autolinking
# files from src/NativeMpv.nitro.ts into nitrogen/generated/.
bun run --filter @jellyfuse/native-mpv nitrogen
```

The `fetch-mpvkit` step must succeed before `expo prebuild` in `apps/mobile`, because the podspec references `vendor/ios/mpvkit-{device,simulator}` during pod install.

## Phase 3a spec

The hybrid object in `src/NativeMpv.nitro.ts` exposes:

- **Lifecycle**: `load(url, options)`, `release()`
- **Transport**: `play()`, `pause()`, `seek(seconds)`
- **Tracks**: `setAudioTrack(id)`, `setSubtitleTrack(id)`, `disableSubtitles()`
- **Rate / volume**: `setRate(r)`, `setVolume(v)`
- **Property bridge**: `setProperty(name, value)`, `getProperty(name)`
- **Listeners** (MMKV-style `Listener { remove() }`):
  - `addProgressListener(onProgress)` — position + duration, fired ~1 Hz
  - `addStateChangeListener(onState)` — idle/loading/playing/paused/ended/error
  - `addEndedListener(onEnded)` — EOF
  - `addErrorListener(onError)` — unrecoverable
  - `addTracksListener(onTracks)` — full audio + subtitle lists after load
  - `addBufferingListener(onBuffering)` — seek/fill-buffer spinner

The Nitrogen-generated `HybridNativeMpvSpec` Swift protocol matches
this shape once you run `bun run nitrogen`.

## Critical mpv options (from the Rust backend)

Set in `HybridNativeMpv.createMpvHandle()`:

- `hwdec=videotoolbox-copy` — plain `videotoolbox` had color correctness bugs in the Rust backend (commit `51fec4ba`). Use `-copy`.
- `vid=no` — phase 3a is audio-only. Phase 3b flips this to `vid=1` once the render context is wired.
- `audio-device=auto` — picks the best output at runtime (AirPlay, Bluetooth, speaker).
- `cache=yes`, `demuxer-max-bytes=50MiB`, `demuxer-max-back-bytes=25MiB` — streaming-friendly defaults.

## Events model — Nitro listener pattern

Nitro supports `(args) => void` callback types as method parameters (see `docs/types/callbacks.md` in the Nitro repo). We store the callbacks in Swift property arrays keyed by event type and invoke them on the JS thread when the corresponding `mpv_event` or property observer fires. `addXxxListener` returns an `MpvListener` whose `remove()` splices the callback out of its array. Identical pattern to `react-native-mmkv`'s `addOnValueChangedListener`.

## References

- `project_jellyfuse_mpv_player.md` memory — why MPVKit, why GL, critical mpv options
- `crates/jf-module-player/src/backend.rs` in the Rust reference — high-level API
- `crates/jf-module-player/src/mpv_video.rs` — desktop/macOS property + command wiring (baseline for the Swift impl — phase 3a)
- `crates/jf-module-player/src/mpv_video_gl.rs` — the 884-line GL render pipeline phase 3b will port
- Rust `Makefile::fetch-mpvkit-ios` — canonical vendor flow the Bash script ports
- Nitro docs — `https://github.com/mrousavy/nitro/tree/main/docs/docs`
