# App Store metadata — en-US — Jellyfuse 1.0.0

Drop these values into App Store Connect → Jellyfuse → 1.0.0 Prepare for Submission.

## App Information

- **Name** (max 30): `Jellyfuse`
- **Subtitle** (max 30): `Native Jellyfin client`
- **Primary category**: Entertainment
- **Secondary category**: Photo & Video
- **Bundle ID**: `com.jellyfuse.app`
- **SKU**: `jellyfuse-ios-1`
- **Content rights**: Does not contain, show, or access third-party content (you bring your own server). If ASC pushes back, switch to "contains third-party content" and reference the BYO-server model.

## Pricing & availability

- Price: Free
- Availability: All territories
- Distribution: App Store only (no pre-orders)

## Age rating questionnaire

- Unrestricted Web Access: **Yes** (the app plays whatever media is on the user-supplied Jellyfin server)
- All other categories: None
- Result: **17+**

## Promotional text (max 170)

```
Stream your Jellyfin library on iPhone with native MPV playback, offline downloads, and instant search. Bring your own server.
```

## Description (max 4000)

```
Jellyfuse is a fast, native iPhone client for Jellyfin, the free software media system you self-host. Connect to your own Jellyfin server and stream movies, TV shows, music, and home videos with a player tuned for quality and battery life.

Highlights:
• Native MPV-powered playback — Direct Play, Direct Stream, and transcode all handled with the same engine that powers desktop video players.
• Background audio — keep your music playing when the screen locks.
• Picture in Picture — keep watching while you do something else.
• Offline downloads — pull episodes and movies onto the device for trips and flights.
• Trickplay scrubbing, chapter markers, and intro / outro skip when your library has them.
• Subtitle and audio track switching, including external subtitle files.
• Fast library browsing with shelves for resume, recently added, and your collections.
• Instant search across your whole library.
• Optional Jellyseerr integration — request the next title without leaving the app.
• Privacy first — Jellyfuse only talks to your server. No analytics, no telemetry, no tracking.

Important: Jellyfuse is an unofficial, third-party client for Jellyfin and Jellyseerr. You need a Jellyfin server you control. Jellyfuse is not affiliated with the Jellyfin or Jellyseerr projects.

To try the app without a server of your own, sign in to the public Jellyfin demo at https://demo.jellyfin.org/stable (any username, leave the password blank).
```

## Keywords (max 100, comma-separated, no spaces wasted)

```
jellyfin,media,player,server,stream,video,movie,tv,jellyseerr,mpv
```

## URLs

- **Support URL**: `https://github.com/OverGlass/jellyfuse/issues`
- **Marketing URL**: `https://github.com/OverGlass/jellyfuse`
- **Privacy Policy URL**: `https://jellyfuse-privacy.tailba6a9d.ts.net/privacy.html`

## Copyright

```
© 2026 Antonin Carlin · Licensed under GPL-3.0
```

## App Review Information

- **Sign-in required to review**: Yes
- **Demo Account → Server URL field**: `https://demo.jellyfin.org/stable`
- **Demo Account → Username**: `demo` _(any value works on the public demo)_
- **Demo Account → Password**: _(leave blank — the public demo accepts empty passwords)_
- **Contact → First name / last name / email / phone**: your details
- **Notes**:

```
Jellyfuse is a third-party client for self-hosted Jellyfin servers. Reviewers without a Jellyfin server can use the official public demo at https://demo.jellyfin.org/stable. On the sign-in screen, enter that URL, any username (e.g. "demo"), and leave the password blank — the public demo accepts empty passwords.

Jellyseerr is an optional integration. To keep the review focused, please leave the Jellyseerr URL field blank during sign-in. The app behaves correctly without it; the Requests UI is hidden until a Jellyseerr server is configured.

There are no in-app purchases, subscriptions, or accounts created by the app itself — credentials live in the iOS Keychain and only authenticate to the user-supplied server.

Privacy policy: https://jellyfuse-privacy.tailba6a9d.ts.net/privacy.html
```

## What's New in this Version (max 4000)

```
First public release. Native MPV playback on iPhone, offline downloads, search, optional Jellyseerr integration. Privacy-first: no telemetry, no tracking.
```

## Build → Version

- iOS version: `1.0.0`
- Build number: assigned by EAS (`appVersionSource: remote`)

## Screenshots checklist

Required: 6.9" iPhone (iPhone 16 Pro Max class). Resolution: **1290 × 2796** portrait.

Capture from `https://demo.jellyfin.org/stable` so library content is real and reviewers see the same data:

- [ ] Sign-in screen (clean, with the demo URL pre-filled if possible)
- [ ] Home with shelves populated
- [ ] Item detail (Movie)
- [ ] Item detail (TV episode list)
- [ ] Player with on-screen controls
- [ ] Search results
- [ ] Downloads
- [ ] Settings

Save to `apps/mobile/store-assets/screenshots/en-US/iphone-69/<NN>-<name>.png`.
