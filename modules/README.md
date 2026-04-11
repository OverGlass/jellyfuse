# Nitro Modules

Native modules built on [Nitro Modules](https://nitro.margelo.com). One TS spec per module, Swift for iOS / tvOS / Catalyst, Kotlin for Android / Android TV.

## Module matrix

| Module | Platforms | Purpose |
|---|---|---|
| `native-mpv` | iOS · tvOS · Catalyst · Android · Android TV | **The only video player.** libmpv render context in a Fabric view. |
| `downloader` | iOS · Android · Android TV | Background downloads. URLSession (iOS) / WorkManager (Android). Manifest-first state machine. |
| `secure-storage` | all | Keychain / Android Keystore. |
| `device-id` | all | Stable device id. Persisted in `secure-storage`. |
| `cookie-jar` | all | Jellyseerr `connect.sid` session cookie. |
| `chromecast` | iOS · Android (not Catalyst) | Google Cast SDK. Gated out of Mac Catalyst builds. |
| `airplay` | iOS · tvOS · Catalyst | `AVRoutePickerView`. |
| `pip` | iOS · Android | AVKit PiP controller / Android `PictureInPictureParams`. |

Skipped on tvOS: `downloader`, `chromecast`.

## Layout per module

```
modules/<name>/
├─ package.json            # @jellyfuse/<name>, workspace:*
├─ README.md               # spec, events, lifecycle, platform matrix
├─ src/index.ts            # TS spec — hybrid object type
├─ ios/                    # Swift impl
│  ├─ <Name>.swift
│  └─ <Name>.podspec       # Catalyst SDK declared where applicable
└─ android/                # Kotlin impl
   ├─ src/main/kotlin/.../<Name>.kt
   └─ build.gradle
```

## Conventions

- Hybrid objects dispose via `release()`. Always release on unmount.
- Events are named `onXxx`, delivered on the JS thread. Subscribe via refs, unsubscribe on unmount.
- Native errors surface as `NitroError { code, message }`. JS maps `code` to user-facing strings.
- Every module declares its platform support in the podspec / `build.gradle` and is excluded from unsupported targets via `#if !targetEnvironment(macCatalyst)` etc.

## Cookbook

When authoring a new module:

1. Write the TS spec first (`src/index.ts`). Types are the contract.
2. Port the behavioural spec from the Rust equivalent (`../../fusion/crates/jf-module-*`).
3. Implement Swift first, then Kotlin.
4. Native unit tests: XCTest (Swift) / JUnit + Robolectric (Kotlin). Focus on state machines, not UI.
5. Document the module in its local README — TS spec, event list, lifecycle, platform matrix.
6. Gate unsupported platforms explicitly. Never rely on runtime feature detection.

## Phase 0a status

Placeholder — real modules land in their respective phases:

| Phase | Module |
|---|---|
| Phase 1 | `secure-storage`, `device-id`, `cookie-jar` |
| Phase 3 | `native-mpv` |
| Phase 5 | `downloader` |
| Phase 9 | `chromecast`, `airplay`, `pip` |
