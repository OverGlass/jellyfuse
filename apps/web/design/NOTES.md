# Design translation notes

The source design lives at `apps/web/design/source.html` (1934 lines). It was authored in
Claude Design as a static HTML/CSS/JS prototype and is the spec we translate into Expo
Router + react-native-web.

## Section order (top → bottom)

1. **Nav** — sticky, transparent until scroll, opaque-blur after.
2. **Hero** — full-viewport headline with vesica-cell gradient wash (ports the app icon's
   exhaust pattern), eyebrow, h1 (split into two lines, second line gradient-clipped),
   lead paragraph, primary + secondary CTA, "Free & open source · No telemetry · GPL-3.0
   licensed" meta strip.
3. **Fusion** — 2-col: copy + ordered list on the left, cropped iPhone mock showing
   blended search results (library hits + request candidates) on the right.
4. **Player band** — full-bleed `--surface` band: giant gradient-clipped numeral "1" on
   the left, "One player. Every codec." headline + horizontally scrolling codec chip rail
   (HEVC, H.264, AV1, VP9, HDR10, HLG, Dolby Vision\*, TrueHD, DTS-HD, PGS, SRT, ASS, etc).
5. **Platforms** — the centerpiece. 2-col grid where the right column is `position:
sticky` and cross-fades between five device frames (iPhone → iPad → TV → Mac →
   Android), driven by `IntersectionObserver` watching the steps in the left column.
   Each step has a status badge: Shipping, Coming soon, In development, Roadmap.
6. **Privacy** — 2-card row: "Yours, end to end" + "Free, forever".
7. **Features** — 3×3 grid of small feature cards (offline downloads, background audio,
   PiP, trickplay, chapters, intro/outro skip, external subtitles, multi-user profiles,
   blended search).
8. **FAQ** — 6-item accessible disclosure list (server, Jellyseerr, devices, free, HDR,
   why MPV), with a "+/×" toggle glyph.
9. **Footer** — 4-col grid (brand + 3 link cols) plus a fine print row with the
   disaffiliation note.

## Color palette

Verbatim from `packages/theme/src/index.ts` (One Dark Pro Darker palette):

| Role            | Hex / value                         |
| --------------- | ----------------------------------- |
| background      | `#1e2227`                           |
| surface         | `#23272e`                           |
| surfaceElevated | `#2c313c`                           |
| border          | `#181a1f`                           |
| hairline        | `rgba(215,218,224,0.08)` (computed) |
| text-primary    | `#d7dae0`                           |
| text-secondary  | `#abb2bf`                           |
| muted           | `#7f848e`                           |
| accent          | `#61afef`                           |
| accent-pressed  | `#528bff`                           |
| accent-contrast | `#181a1f`                           |
| success         | `#98c379`                           |
| warning         | `#d19a66`                           |
| danger          | `#e06c75`                           |
| profile palette | 8-stop gradient sweep used in hero  |

## Type system

Body stack: `-apple-system, "SF Pro Text", Inter, system-ui, sans-serif`
Display stack: `"SF Pro Display", -apple-system, Inter, sans-serif`
No web fonts. No mono.

Marketing type ramp uses CSS `clamp()` for responsive sizing (web-only, RNW passes
strings through):

- h1: `clamp(48px, 6.5vw, 96px)` 700 weight, -0.035em tracking, 1.05 line-height
- h2: `clamp(36px, 4.5vw, 64px)` 600 weight, -0.025em tracking
- h3: `clamp(22px, 2vw, 28px)` 600 weight
- player numeral: `clamp(160px, 22vw, 320px)` gradient-clipped
- lead: `clamp(18px, 1.5vw, 22px)`
- gutter: `clamp(20px, 4vw, 48px)`

Diff vs `packages/theme`: the marketing ramp goes well beyond the mobile `display=32`
because cinematic landing typography exceeds in-app. We add `spacing.xxxl=96`, `radius.xl=24`,
and `opacity.alpha08=0.08` to `packages/theme/src/index.ts` so all repos can reach for
them; the responsive `clamp()` ranges stay inline as page-local typography decisions
(they have no parallel in the mobile app).

## Animations / scroll behaviour

- **Nav** — `is-scrolled` class toggled when `window.scrollY > 8`.
- **Reveal-on-scroll** — opacity 0 + 8px translateY → 1 + 0 over 600ms cubic-bezier
  `(.2,.8,.2,1)`, with optional `data-delay="1|2|3"` (100/200/300ms) cascade.
- **Platform stage** — sticky `top:12vh, height:76vh`. Frames cross-fade
  `opacity 0→1 + scale .96→1` over 700ms cubic-bezier `(.2,.8,.2,1)`.
  IntersectionObserver `rootMargin: -40% 0% -40% 0%` so a step is "active" only when its
  middle is in the middle 20% of the viewport — gives the frame plenty of time to
  cross-fade.
- **Hero halo** — radial-gradient halo drifts via `@keyframes drift` (14s, ease-in-out,
  alternate). Pure CSS.
- **Hero cells** — 22 vesica lens paths laid horizontally across an SVG with
  `feGaussianBlur stdDeviation=28` and the profile palette swept across via JS.
- **prefers-reduced-motion** disables all of the above; only the active frame is shown
  (others are `display:none`) and the IO is not registered.

## Third-party assets / dependencies

- App icon: `apps/mobile/assets/images/icon.png` → copied to `apps/web/public/icon.png`.
- Favicon: `apps/mobile/assets/images/favicon.png` → copied to `apps/web/public/favicon.png`.
- Screenshots: not used in the design (device frames render gradient placeholders, which
  matches the system).
- No web fonts. The system font stack is the spec.
- `react-native-svg` is the only added runtime dep — required for the hero vesica cells
  and the platform-step / feature-card / privacy-card icons.

## What we deliberately cut from the prototype

- Inline `<svg>` and CSS class names — translated to react-native-svg primitives and
  `StyleSheet.create({})`.
- The `<details>/<summary>` accordion — replaced with a controlled `Pressable` disclosure
  with `aria-expanded` so React Native renders to a single component with proper ARIA.
- Hard-coded device-specific dimensions in the hero silhouettes — flattened to a single
  parameterised `DeviceFrame` set we can reuse.
