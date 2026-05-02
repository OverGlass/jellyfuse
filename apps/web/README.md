# @jellyfuse/web

Marketing landing page for Jellyfuse, built with Expo Router + react-native-web. Statically exported for GitHub Pages.

## Develop

```bash
bun run --filter @jellyfuse/web start
```

Opens the Expo dev server in the browser on port 8083.

## Build

```bash
bun run --filter @jellyfuse/web build:web
```

Produces `apps/web/dist/` with static HTML, JS, and assets ready for any static host.

## Preview the build locally

```bash
bun run --filter @jellyfuse/web serve
```

Open http://localhost:3000.

## Deploy

Pushed to `main` → `.github/workflows/deploy-web.yml` builds and publishes the `dist/` output to the `gh-pages` branch via `peaceiris/actions-gh-pages`. The Jekyll privacy page (`docs/privacy.md`) is preserved on `main` and continues to serve at `/privacy.html`.

## Quality gates

```bash
bun run --filter @jellyfuse/web typecheck
bun run --filter @jellyfuse/web lint
bun run format:check
```

## Layout

- `app.config.ts` — Expo config (`output: "static"`, `baseUrl: "/jellyfuse"`)
- `design/` — original Claude Design HTML, CSS, and translation notes (reference only)
- `public/` — static assets (favicon, icon, screenshots, og-image)
- `src/app/` — Expo Router routes (`_layout.tsx`, `index.tsx`, `+not-found.tsx`)
- `src/sections/` — one file per top-level page section
- `src/components/` — shared building blocks (device frames, FAQ disclosure, status pill…)
- `src/lib/` — page hooks (scroll-pin, reveal-on-scroll, nav scroll state) and copy
