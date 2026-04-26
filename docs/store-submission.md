# App Store submission runbook

How to ship an iOS release of Jellyfuse to the App Store. Long-lived; per-release notes go in `docs/release-notes/vX.Y.Z.md`.

## One-time setup (done for v1)

- App Store Connect record exists for `com.jellyfusion.app` (Apple Team `39TMVBW2CY`, ASC app ID `6761692584`).
- Apple agreements signed.
- 1Password vault `Jellyfuse CI` contains:
  - `AppleID/email`
  - `AppleID/app-specific-password` ([generate at appleid.apple.com](https://appleid.apple.com/account/manage))
- Privacy Policy is served by GitHub Pages at <https://overglass.github.io/jellyfuse/privacy.html>. Source is `docs/privacy.md`; Jekyll renders on every push to `main`. Enable in Settings → Pages → source `main`, folder `/docs`.
- `eas credentials` has registered the iOS distribution certificate and App Store provisioning profile.

## Per-release flow

1. **Cut a branch** off `main`: `git worktree add -b release/vX.Y.Z .claude/worktrees/release-vX.Y.Z main`.
2. **Bump `version`** in `apps/mobile/app.config.ts`. EAS handles the build number via `appVersionSource: remote`.
3. **Write release notes** in `docs/release-notes/vX.Y.Z.md`. Copy the "What's New" copy verbatim.
4. **Update screenshots** in `apps/mobile/store-assets/screenshots/en-US/iphone-65/` and `ipad-13/` if UI changed materially. See "Capturing screenshots" below.
5. **Pre-flight:**
   ```
   bun run typecheck
   bun run test
   bun run format:check
   bun run --filter @jellyfuse/mobile assets:icon-check
   ```
6. **Smoke a local production build** (catches native issues without burning a remote build):
   ```
   op run --env-file=.env.tpl -- eas build --platform ios --profile production --local
   ```
7. **Remote production build + submit:**
   ```
   op run --env-file=.env.tpl -- eas build --platform ios --profile production
   op run --env-file=.env.tpl -- eas submit --platform ios --profile production --latest
   ```
8. **In App Store Connect:**
   - Create a new version (`X.Y.Z`).
   - Paste metadata from `apps/mobile/store-assets/metadata/en-US.md`.
   - Attach screenshots.
   - Confirm App Review notes and demo credentials.
   - **Submit for Review.**
9. **After approval:** tag `vX.Y.Z`, draft GitHub release linking to the release-notes file, enable phased release in ASC.

## Capturing screenshots (argent)

Sign in to `https://demo.jellyfin.org/stable` (any username, blank password) on each device class.

**iPhone** — boot iPhone 14 Pro Max simulator. Required size: **1284 × 2778** portrait. Save to `apps/mobile/store-assets/screenshots/en-US/iphone-65/`.

**iPad** — boot iPad Pro 13" (M4) simulator. Required size: **2064 × 2752** portrait (or 2048 × 2732 for iPad Pro 12.9"). Save to `apps/mobile/store-assets/screenshots/en-US/ipad-13/`.

```
1. screenshot                         → baseline
2. describe                           → find login fields
3. type URL, tap Continue
4. (loop) describe → tap → screenshot for each target screen
```

Always discover before you tap (`describe` / `debugger-component-tree`). Never derive coordinates from a screenshot.

## Common review rejections to expect

- **5.2.3 third-party content** — pre-empted by the explicit "unofficial client, BYO server" line in the description.
- **4.0 minimum functionality** — pre-empted by the public demo server being available to reviewers.
- **2.1 incomplete** — pre-empted by demo creds in App Review notes and Jellyseerr being gated cleanly.
- **2.5.1 non-public API** — should not happen; flag in CI any new native dependency that uses private headers.

If rejected, respond in App Store Connect's Resolution Center within 7 days with a fix or clarification. Do not resubmit a new build until you have read the rejection — reviewers cite specific guideline numbers.

## What this runbook does not cover

- TestFlight external testing — separate flow; configure once a cohort exists.
- tvOS / Android / Catalyst submissions — out of scope until those phases ship.
