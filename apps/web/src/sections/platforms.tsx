import { Text, View } from "react-native";
import { colors, fontWeight, spacing } from "@jellyfuse/theme";

import {
  AndroidFrame,
  IPhoneFrame,
  IPadFrame,
  MacFrame,
  TvFrame,
} from "../components/device-frame";
import { BulletList } from "../components/bullet-list";
import { Eyebrow } from "../components/eyebrow";
import { Heading } from "../components/heading";
import { Poster, Shelf, MockHero, MockStatusBar } from "../components/posters";
import { Reveal } from "../components/reveal";
import { Section } from "../components/section";
import { StatusPill } from "../components/status-pill";
import { CONTAINER_MAX_WIDTH, GUTTER, HAIRLINE } from "../components/layout";
import { webStyles } from "../components/web-styles";
import { PLATFORM_STEPS, PLATFORMS_INTRO } from "../lib/content";
import type { PlatformId } from "../lib/content";
import { useScrollPin } from "../lib/use-scroll-pin";

// Centrepiece. Two-column grid: scrolling steps on the left,
// `position: sticky` device-frame stage on the right. The active step
// drives a cross-fade between five frames; reduced-motion users get the
// active frame only (CSS rule kills transitions, frame stack still
// exists in DOM).
//
// The IO uses rootMargin -40% top/bottom so a step is "active" only when
// its middle is in the middle 20% of the viewport — gives the frame
// plenty of time to cross-fade.
export function Platforms() {
  const { activeFrame, registerStep } = useScrollPin("iphone");
  return (
    <Section padding="none" bordered="top" nativeID="platforms">
      <View style={styles.section}>
        <Reveal style={styles.intro}>
          <Eyebrow>{PLATFORMS_INTRO.eyebrow}</Eyebrow>
          <Heading level={2} style={styles.introHeadline}>
            {PLATFORMS_INTRO.headlineLine1}
            {"\n"}
            {PLATFORMS_INTRO.headlineLine2}
          </Heading>
        </Reveal>

        <View style={styles.grid}>
          <View style={styles.copyCol}>
            {PLATFORM_STEPS.map((step, idx) => (
              <View
                key={step.id}
                ref={registerStep(step.id)}
                style={[styles.step, idx === 0 ? styles.firstStep : null]}
              >
                <StatusPill status={step.status} label={step.statusLabel} />
                <Heading level={3} style={styles.stepHeadline}>
                  {step.headlineLine1}
                  {"\n"}
                  {step.headlineLine2}
                </Heading>
                <Text style={styles.stepBody}>{step.body}</Text>
                <BulletList items={step.bullets} />
              </View>
            ))}
          </View>

          <View aria-hidden style={styles.stage}>
            <View style={styles.stageInner}>
              <PlatformFrame id="iphone" active={activeFrame === "iphone"}>
                <IPhoneFrame>
                  <View style={styles.iphoneInner}>
                    <MockStatusBar />
                    <View style={styles.scrHero}>
                      <View style={styles.scrHeroFade} />
                      <Text style={styles.scrHeroTitle}>Continue Watching</Text>
                    </View>
                    <Shelf
                      title="For You"
                      posters={[{ variant: 1 }, { variant: 2 }, { variant: 3 }, { variant: 4 }]}
                    />
                    <Shelf
                      title="Recently Added"
                      posters={[{ variant: 5 }, { variant: 6 }, { variant: 2 }, { variant: 1 }]}
                    />
                  </View>
                </IPhoneFrame>
              </PlatformFrame>

              <PlatformFrame id="ipad" active={activeFrame === "ipad"}>
                <IPadFrame>
                  <View style={styles.ipadInner}>
                    <View style={styles.ipadSidebar}>
                      <SidebarLink label="Home" active />
                      <SidebarLink label="Movies" />
                      <SidebarLink label="Shows" />
                      <SidebarLink label="Downloads" />
                      <SidebarLink label="Search" />
                      <SidebarLink label="Requests" />
                    </View>
                    <View style={styles.ipadMain}>
                      <View style={styles.ipadHero}>
                        <View style={styles.scrHeroFade} />
                        <View style={styles.ipadHeroLabel}>
                          <Text style={styles.ipadHeroTitle}>The Lost Ledger</Text>
                          <Text style={styles.ipadHeroSub}>S2 · E4 · 47m</Text>
                        </View>
                      </View>
                      <Text style={styles.ipadShelfTitle}>Continue Watching</Text>
                      <View style={styles.ipadShelfRow}>
                        <Poster variant={1} shape="wide" width={96} />
                        <Poster variant={2} shape="wide" width={96} />
                        <Poster variant={3} shape="wide" width={96} />
                        <Poster variant={4} shape="wide" width={96} />
                      </View>
                    </View>
                  </View>
                </IPadFrame>
              </PlatformFrame>

              <PlatformFrame id="tv" active={activeFrame === "tv"}>
                <TvFrame>
                  <View style={styles.tvInner}>
                    <View style={styles.tvHero}>
                      <Text style={styles.tvHeroTitle}>Whitewater</Text>
                      <Text style={styles.tvHeroSub}>Documentary · 2024 · 1h 32m</Text>
                    </View>
                    <View style={styles.tvRow}>
                      <View style={[styles.tvTile, styles.tvTileFocus]} />
                      <View style={styles.tvTile} />
                      <View style={styles.tvTile} />
                      <View style={styles.tvTile} />
                      <View style={styles.tvTile} />
                      <View style={styles.tvTile} />
                    </View>
                  </View>
                </TvFrame>
              </PlatformFrame>

              <PlatformFrame id="mac" active={activeFrame === "mac"}>
                <MacFrame>
                  <View style={styles.macInner}>
                    <View style={styles.macSidebar}>
                      <View style={styles.macTraffic}>
                        <View style={[styles.trafficDot, { backgroundColor: "#ff5f57" }]} />
                        <View style={[styles.trafficDot, { backgroundColor: "#febc2e" }]} />
                        <View style={[styles.trafficDot, { backgroundColor: "#28c840" }]} />
                      </View>
                      <SidebarLink label="Home" active small />
                      <SidebarLink label="Movies" small />
                      <SidebarLink label="Shows" small />
                      <SidebarLink label="Music" small />
                      <SidebarLink label="Search" small />
                      <SidebarLink label="Requests" small />
                      <SidebarLink label="Downloads" small />
                    </View>
                    <View style={styles.macMain}>
                      <View style={styles.macGrid}>
                        {[1, 2, 3, 4, 5, 6, 2, 1, 3, 4, 5, 6].map((v, idx) => (
                          <Poster key={idx} variant={v as 1 | 2 | 3 | 4 | 5 | 6} />
                        ))}
                      </View>
                    </View>
                  </View>
                </MacFrame>
              </PlatformFrame>

              <PlatformFrame id="android" active={activeFrame === "android"}>
                <AndroidFrame>
                  <MockStatusBar />
                  <MockHero title="Cobalt Sky" subtitle="Movie · 2024 · 1h 58m" />
                  <Shelf
                    title="Recently Added"
                    posters={[{ variant: 3 }, { variant: 4 }, { variant: 5 }, { variant: 6 }]}
                  />
                  <Shelf
                    title="Continue Watching"
                    posters={[{ variant: 1 }, { variant: 2 }, { variant: 3 }]}
                  />
                </AndroidFrame>
              </PlatformFrame>
            </View>
          </View>
        </View>
      </View>
    </Section>
  );
}

type PlatformFrameProps = {
  id: PlatformId;
  active: boolean;
  children: React.ReactNode;
};

function PlatformFrame({ id, active, children }: PlatformFrameProps) {
  return (
    <View
      style={[
        styles.frame,
        active ? styles.frameActive : null,
        {
          transitionProperty: "opacity, transform",
          transitionDuration: "700ms",
          transitionTimingFunction: "cubic-bezier(.2,.8,.2,1)",
        },
      ]}
      data-frame={id}
    >
      {children}
    </View>
  );
}

type SidebarLinkProps = { label: string; active?: boolean; small?: boolean };

function SidebarLink({ label, active = false, small = false }: SidebarLinkProps) {
  return (
    <View
      style={[
        styles.sidebarLink,
        small ? styles.sidebarLinkSmall : null,
        active ? styles.sidebarLinkActive : null,
      ]}
    >
      <View style={[styles.sidebarSquare, active ? styles.sidebarSquareActive : null]} />
      <Text
        style={[
          styles.sidebarText,
          active ? styles.sidebarTextActive : null,
          small ? styles.sidebarTextSmall : null,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = webStyles({
  section: {
    paddingTop: "clamp(64px, 9vw, 120px)",
  },
  intro: {
    maxWidth: 720,
    alignSelf: "center",
    alignItems: "center",
    marginHorizontal: "auto",
    marginBottom: spacing.xxxl,
    paddingHorizontal: GUTTER,
    width: "100%",
  },
  introHeadline: {
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "clamp(32px, 6vw, 96px)",
    alignItems: "flex-start",
    maxWidth: CONTAINER_MAX_WIDTH,
    width: "100%",
    marginHorizontal: "auto",
    paddingHorizontal: GUTTER,
  },
  copyCol: {
    flex: 1,
    minWidth: 280,
    flexDirection: "column",
  },
  step: {
    minHeight: "80vh",
    flexDirection: "column",
    justifyContent: "center",
    paddingVertical: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  firstStep: {
    borderTopWidth: 0,
  },
  stepHeadline: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    fontSize: "clamp(28px, 3.5vw, 44px)",
  },
  stepBody: {
    color: colors.textSecondary,
    fontSize: 17,
    lineHeight: "1.5",
    maxWidth: "44ch",
    marginBottom: spacing.lg,
  },
  stage: {
    flex: 1,
    minWidth: 280,
    height: "76vh",
    position: "sticky",
    top: "12vh",
    alignItems: "center",
    justifyContent: "center",
  },
  stageInner: {
    position: "relative",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  frame: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0,
    transform: [{ scale: 0.96 }],
    pointerEvents: "none",
  },
  frameActive: {
    opacity: 1,
    transform: [{ scale: 1 }],
  },
  // ─── iPhone inner ─────────────────────────────────────────────────
  iphoneInner: {
    paddingBottom: 16,
  },
  scrHero: {
    height: "42%",
    backgroundImage: "linear-gradient(135deg, #355c7d, #2c3e50)",
    position: "relative",
    overflow: "hidden",
  },
  scrHeroFade: {
    position: "absolute",
    inset: 0,
    backgroundImage: `linear-gradient(180deg, transparent 50%, ${colors.background} 100%)`,
  },
  scrHeroTitle: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 12,
    fontSize: 14,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  // ─── iPad inner ───────────────────────────────────────────────────
  ipadInner: {
    flexDirection: "row",
    flex: 1,
  },
  ipadSidebar: {
    width: 80,
    paddingHorizontal: 6,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: HAIRLINE,
    gap: 4,
  },
  ipadMain: {
    flex: 1,
    padding: 12,
    overflow: "hidden",
  },
  ipadHero: {
    height: "50%",
    borderRadius: 8,
    overflow: "hidden",
    backgroundImage: "linear-gradient(135deg, #355c7d, #2c3e50)",
    position: "relative",
  },
  ipadHeroLabel: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 12,
  },
  ipadHeroTitle: {
    fontSize: 14,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  ipadHeroSub: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },
  ipadShelfTitle: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
  },
  ipadShelfRow: {
    flexDirection: "row",
    gap: 8,
  },
  // ─── TV inner ─────────────────────────────────────────────────────
  tvInner: {
    flex: 1,
    flexDirection: "column",
  },
  tvHero: {
    flex: 1,
    paddingHorizontal: 32,
    paddingVertical: 24,
    backgroundImage:
      "linear-gradient(90deg, rgba(30,34,39,0.85), rgba(30,34,39,0.2) 60%, transparent), linear-gradient(135deg, #1a3a55, #2a1a3a)",
    justifyContent: "flex-end",
    gap: 6,
  },
  tvHeroTitle: {
    fontSize: 22,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
    letterSpacing: -0.01 * 22,
  },
  tvHeroSub: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  tvRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  tvTile: {
    width: 80,
    aspectRatio: 16 / 9,
    borderRadius: 4,
    backgroundColor: colors.surfaceElevated,
  },
  tvTileFocus: {
    outlineColor: colors.accent,
    outlineStyle: "solid",
    outlineWidth: 2,
    outlineOffset: 3,
    transform: [{ scale: 1.05 }],
  },
  // ─── Mac inner ────────────────────────────────────────────────────
  macInner: {
    flex: 1,
    flexDirection: "row",
  },
  macSidebar: {
    width: 110,
    paddingHorizontal: 8,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: HAIRLINE,
  },
  macTraffic: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 14,
    paddingLeft: 4,
  },
  trafficDot: {
    width: 9,
    height: 9,
    borderRadius: 9999,
  },
  macMain: {
    flex: 1,
    padding: 12,
  },
  macGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  // ─── Sidebar shared ───────────────────────────────────────────────
  sidebarLink: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 1,
  },
  sidebarLinkSmall: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    gap: 6,
  },
  sidebarLinkActive: {
    backgroundColor: colors.accent,
  },
  sidebarSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
    opacity: 0.4,
  },
  sidebarSquareActive: {
    backgroundColor: colors.accentContrast,
    opacity: 1,
  },
  sidebarText: {
    fontSize: 9,
    color: colors.textSecondary,
  },
  sidebarTextSmall: {
    fontSize: 10,
  },
  sidebarTextActive: {
    color: colors.accentContrast,
    fontWeight: fontWeight.semibold,
  },
});
