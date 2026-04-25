# App Store submission runbook

How to ship an iOS release of Jellyfuse to the App Store. Long-lived; per-release notes go in `docs/release-notes/vX.Y.Z.md`.

## One-time setup (done for v1)

- App Store Connect record exists for `com.jellyfuse.app` (Apple Team `39TMVBW2CY`, ASC app ID `6761692584`).
- Apple agreements signed.
- 1Password vault `Jellyfuse CI` contains:
  - `AppleID/email`
  - `AppleID/app-specific-password` ([generate at appleid.apple.com](https://appleid.apple.com/account/manage))
- 1Password vault `Jellyfuse Dev` contains:
  - `privacy/ssh-host` and `privacy/ssh-path` for the self-hosted Privacy Policy server.
- Privacy Policy is self-hosted on the homelab (`jellyfuse-privacy` service) and exposed via Tailscale Funnel at <https://jellyfuse-privacy.tailba6a9d.ts.net/privacy.html>. Update with `op run --env-file=.env.tpl -- bun run privacy:deploy` after editing `docs/privacy.md`.
- `eas credentials` has registered the iOS distribution certificate and App Store provisioning profile.

## Per-release flow

1. **Cut a branch** off `main`: `git worktree add -b release/vX.Y.Z .claude/worktrees/release-vX.Y.Z main`.
2. **Bump `version`** in `apps/mobile/app.config.ts`. EAS handles the build number via `appVersionSource: remote`.
3. **Write release notes** in `docs/release-notes/vX.Y.Z.md`. Copy the "What's New" copy verbatim.
4. **Update screenshots** in `apps/mobile/store-assets/screenshots/en-US/iphone-69/` if UI changed materially. See "Capturing screenshots" below.
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

Boot iPhone 16 Pro Max simulator (6.9" — covers all required iPhone sizes). Sign in to `https://demo.jellyfin.org/stable`.

```
1. screenshot                         → baseline
2. describe                           → find login fields
3. type URL, tap Continue
4. (loop) describe → tap → screenshot for each target screen
5. save PNGs to apps/mobile/store-assets/screenshots/en-US/iphone-69/
```

Always discover before you tap (`describe` / `debugger-component-tree`). Never derive coordinates from a screenshot. Required size: **1290 × 2796** portrait.

## Common review rejections to expect

- **5.2.3 third-party content** — pre-empted by the explicit "unofficial client, BYO server" line in the description.
- **4.0 minimum functionality** — pre-empted by the public demo server being available to reviewers.
- **2.1 incomplete** — pre-empted by demo creds in App Review notes and Jellyseerr being gated cleanly.
- **2.5.1 non-public API** — should not happen; flag in CI any new native dependency that uses private headers.

If rejected, respond in App Store Connect's Resolution Center within 7 days with a fix or clarification. Do not resubmit a new build until you have read the rejection — reviewers cite specific guideline numbers.

## What this runbook does not cover

- TestFlight external testing — separate flow; configure once a cohort exists.
- tvOS / Android / Catalyst submissions — out of scope until those phases ship.
