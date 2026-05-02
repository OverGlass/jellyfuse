// All marketing copy as typed constants — single source of truth for the
// landing page. Sections pull from here so the wording can be reviewed in
// one place.

export const SITE = {
  name: "Jellyfuse",
  tagline: "One Jellyfin client. Every screen.",
  description:
    "A Jellyfin client built around MPV. Watch your library, request what's next, on every screen you own.",
  repoUrl: "https://github.com/OverGlass/jellyfuse",
  privacyUrl: "https://overglass.github.io/jellyfuse/privacy.html",
  issuesUrl: "https://github.com/OverGlass/jellyfuse/issues",
  releasesUrl: "https://github.com/OverGlass/jellyfuse/releases",
  licenseUrl: "https://github.com/OverGlass/jellyfuse/blob/main/LICENSE",
  // v1.0 is currently in App Store review; the public TestFlight is the
  // honest CTA target until the listing goes live.
  testFlightUrl: "https://testflight.apple.com/join/rz3vDx8g",
} as const;

export const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "Platforms", href: "#platforms" },
  { label: "FAQ", href: "#faq" },
] as const;

export const HERO = {
  eyebrow: "Jellyfin client · v1.0 in TestFlight",
  // Two-line headline: line two carries a gradient-clipped style.
  headlineLine1: "One Jellyfin client.",
  headlineLine2: "Every screen.",
  lead: "Watch your library. Request what's next. From your phone to the living room — same app, same player, no subscription.",
  primaryCta: "Join the TestFlight",
  secondaryCta: "Star on GitHub",
  meta: ["Free & open source", "No telemetry", "GPL-3.0 licensed"],
} as const;

export const FUSION = {
  eyebrow: "The fusion",
  headlineLine1: "Watching and requesting,",
  headlineLine2: "finally in one app.",
  lead: "Search blends your library with what's available to request. Tap a result to watch, or queue it up for your server to fetch.",
  steps: [
    {
      num: "01",
      strong: "Browse and play your library.",
      tail: " Shelves, search, downloads — all the basics, native everywhere.",
    },
    {
      num: "02",
      strong: "Request what's missing.",
      tail: " Movies, full series or single seasons — Jellyseerr is built in, not a separate app.",
    },
    {
      num: "03",
      strong: "See progress in context.",
      tail: " Pending requests show up next to your shelves. No tab-hopping.",
    },
  ],
} as const;

export const FUSION_MOCK = {
  query: "Dune",
  library: [
    { title: "Dune: Part One", meta: "2021 · 4K HDR · 2h 35m", action: "Play" },
    { title: "Dune: Part Two", meta: "2024 · 4K · Watched 32%", action: "Resume" },
  ],
  request: [
    { title: "Dune: Prophecy", meta: "Series · 2024 · 6 episodes", action: "Request" },
    { title: "Dune (1984)", meta: "Movie · 2h 17m", action: "Request" },
  ],
} as const;

export const PLAYER = {
  eyebrow: "One player",
  headlineLine1: "One player.",
  headlineLine2: "Every codec.",
  lead: "MPV powers playback on every platform — same subtitles, same audio routing, same codec ceiling, whether you're on the couch or in line at the airport.",
  numeral: "1",
  // `is-strong` chips render with stronger text and border vs. the dimmer chips.
  // The order matches the design's chip rail.
  chips: [
    { label: "HEVC", strong: true },
    { label: "H.264", strong: true },
    { label: "AV1", strong: true },
    { label: "VP9", strong: false },
    { label: "HDR10", strong: false },
    { label: "HLG", strong: false },
    { label: "Dolby Vision*", strong: false },
    { label: "TrueHD", strong: false },
    { label: "DTS-HD", strong: false },
    { label: "PGS", strong: false },
    { label: "SRT", strong: false },
    { label: "ASS", strong: false },
    { label: "External tracks", strong: false },
  ],
} as const;

export type PlatformId = "iphone" | "ipad" | "tv" | "mac" | "android";
export type PlatformStatus = "shipping" | "soon" | "indev" | "roadmap";

export const PLATFORMS_INTRO = {
  eyebrow: "Platforms",
  headlineLine1: "Built for every screen",
  headlineLine2: "you already own.",
} as const;

export const PLATFORM_STEPS: readonly {
  id: PlatformId;
  status: PlatformStatus;
  statusLabel: string;
  headlineLine1: string;
  headlineLine2: string;
  body: string;
  bullets: readonly string[];
}[] = [
  {
    id: "iphone",
    status: "shipping",
    statusLabel: "Public TestFlight",
    headlineLine1: "iPhone.",
    headlineLine2: "The one you carry.",
    body: "The flagship. Every feature lands here first — native MPV, offline downloads, blended search, requests, multi-user. v1.0 is in App Store review; the public TestFlight is open today.",
    bullets: [
      "Background audio & PiP",
      "Offline downloads with resume",
      "Trickplay scrubbing & chapters",
    ],
  },
  {
    id: "ipad",
    status: "soon",
    statusLabel: "Coming soon",
    headlineLine1: "iPad.",
    headlineLine2: "More canvas, more shelves.",
    body: "A sidebar layout that takes advantage of the bigger screen. Multitasking-friendly, hover-aware, built for split view.",
    bullets: ["Sidebar navigation", "Split view multitasking", "AirPlay to your TV"],
  },
  {
    id: "tv",
    status: "indev",
    statusLabel: "In development",
    headlineLine1: "Living-room TV.",
    headlineLine2: "Lean back, focus forward.",
    body: "A focus-driven UI for remote-friendly browsing. The same MPV engine, optimized for 10-foot reading distance.",
    bullets: ["Focus engine + remote control", "4K HDR pass-through", "Dolby Atmos pass-through"],
  },
  {
    id: "mac",
    status: "indev",
    statusLabel: "In development",
    headlineLine1: "Mac.",
    headlineLine2: "A first-class target.",
    body: "Mac Catalyst, not a wrapped iPad app. Window management, keyboard shortcuts, menu bar — handled like a real desktop client.",
    bullets: ["Native window chrome", "Keyboard-first navigation", "Background downloads"],
  },
  {
    id: "android",
    status: "indev",
    statusLabel: "In development",
    headlineLine1: "Android.",
    headlineLine2: "Same engine, different OS.",
    body: "One MPV build. One feature set. Whether you're on iOS or Android, you get the same player and the same UI vocabulary.",
    bullets: ["Phone & tablet", "Android TV (roadmap)", "Chromecast (roadmap)"],
  },
];

export const PRIVACY = {
  eyebrow: "Yours, on your terms",
  cards: [
    {
      title: "Yours, end to end.",
      body: "Jellyfuse talks only to your server. No analytics. No telemetry. No third-party SDKs. Inspect every byte if you want — the source is public.",
    },
    {
      title: "Free, forever.",
      body: "GPL-3.0 licensed. No Pro tier. No paywalled features. No accounts. Build it yourself or grab the latest release — the choice is yours.",
    },
  ],
} as const;

export const FEATURES = {
  eyebrow: "Built right",
  headline: "The details that matter.",
  lead: "Nine years of Jellyfin clients have taught us what people actually use. We built those things first.",
  cards: [
    {
      title: "Offline downloads",
      body: "Pause, resume, skip, retry. Built for spotty Wi-Fi and long flights.",
      icon: "download" as const,
    },
    {
      title: "Background audio",
      body: "Lock the screen, keep listening. Audiobooks and concerts work the way you'd expect.",
      icon: "audio" as const,
    },
    {
      title: "Picture in Picture",
      body: "Float your show in a corner while you reply to that message. System-native PiP.",
      icon: "pip" as const,
    },
    {
      title: "Trickplay scrubbing",
      body: "Frame-accurate previews under the seek bar — no more guessing where you are.",
      icon: "trickplay" as const,
    },
    {
      title: "Chapter markers",
      body: "Jump straight to the cold open, the title sequence, or the credits. Honor your time.",
      icon: "chapters" as const,
    },
    {
      title: "Intro & outro skip",
      body: "One tap. Already detected. Get to the story faster.",
      icon: "skip" as const,
    },
    {
      title: "External subtitles",
      body: "Drop in .srt or .ass — full styling, including karaoke and overrides. MPV does the rendering.",
      icon: "subtitles" as const,
    },
    {
      title: "Multi-user profiles",
      body: "Switch accounts in two taps. Each profile keeps its own resume points and settings.",
      icon: "users" as const,
    },
    {
      title: "Blended search",
      body: "One search bar. Library hits and request candidates side by side, clearly labeled.",
      icon: "search" as const,
    },
  ],
} as const;

export type FeatureIconId = (typeof FEATURES)["cards"][number]["icon"];

export const FAQ = {
  eyebrow: "Questions",
  headline: "The short answers.",
  items: [
    {
      q: "Do I need a Jellyfin server?",
      a: "Yes. Jellyfuse is a client — you bring your own server. We never see your data, your library, or your viewing habits.",
    },
    {
      q: "Do I need Jellyseerr?",
      a: "No. Requests are optional. If you don't run Jellyseerr, the request UI hides itself and Jellyfuse behaves as a pure Jellyfin client.",
    },
    {
      q: "Which devices are supported?",
      a: "iPhone today. iPad, Apple TV, Mac, and Android are in active development — see the Platforms section above for status on each.",
    },
    {
      q: "Is it really free?",
      a: "Yes. GPL-3.0 licensed, no paywall, no telemetry. Build it yourself from source, join the public TestFlight, or wait for the App Store listing once review clears.",
    },
    {
      q: "What about HDR and Dolby Vision?",
      a: "HDR10 and Dolby Vision over HDR10 ship in an upcoming update. HLG works today on supported devices.",
    },
    {
      q: "Why MPV?",
      a: "One battle-tested playback engine on every platform means identical subtitle rendering, identical audio routing, and identical codec support — no per-device surprises.",
    },
  ],
} as const;

export const FOOTER = {
  blurb: SITE.description,
  columns: [
    {
      title: "Project",
      links: [
        { label: "GitHub", href: SITE.repoUrl },
        { label: "Release notes", href: SITE.releasesUrl },
        { label: "Issues", href: SITE.issuesUrl },
        { label: "Roadmap", href: `${SITE.repoUrl}#status` },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy", href: SITE.privacyUrl },
        { label: "License (GPL-3.0)", href: SITE.licenseUrl },
      ],
    },
    {
      title: "Source",
      links: [
        { label: "CLAUDE.md", href: `${SITE.repoUrl}/blob/main/CLAUDE.md` },
        { label: "README", href: `${SITE.repoUrl}#readme` },
      ],
    },
  ],
  fineLeft: "Made with care · 2026",
  fineRight: "Jellyfuse is not affiliated with the Jellyfin project.",
} as const;
