import { Text, View } from "react-native";
import Svg, { Defs, Filter, FeGaussianBlur, G, Path } from "react-native-svg";
import { colors, spacing } from "@jellyfuse/theme";

import { CtaButton } from "../components/cta-button";
import { Eyebrow } from "../components/eyebrow";
import { Heading } from "../components/heading";
import { Reveal } from "../components/reveal";
import { GUTTER } from "../components/layout";
import { webStyles } from "../components/web-styles";
import { HERO_CELLS, HERO_VIEWBOX } from "../lib/hero-cells";
import { HERO, SITE } from "../lib/content";

// Hero — full-viewport headline over the vesica-cell exhaust pattern
// ported from the app icon. Cells are pre-computed at module scope so
// the whole hero is server-renderable; the only runtime motion is the
// CSS keyframe `drift` on the silhouette layer.
export function Hero() {
  return (
    <View aria-labelledby="hero-h" style={styles.hero}>
      <View aria-hidden style={styles.wash}>
        <Svg
          viewBox={HERO_VIEWBOX}
          preserveAspectRatio="none"
          style={styles.cells}
          width="100%"
          height="100%"
        >
          <Defs>
            <Filter id="cellBlur" x="-15%" y="-15%" width="130%" height="130%">
              <FeGaussianBlur stdDeviation={28} />
            </Filter>
          </Defs>
          <G filter="url(#cellBlur)">
            {HERO_CELLS.map((cell, i) => (
              <Path key={i} d={cell.d} fill={cell.fill} />
            ))}
          </G>
        </Svg>
        <View style={styles.floor} />
      </View>

      <View style={styles.inner}>
        <Reveal>
          <Eyebrow>{HERO.eyebrow}</Eyebrow>
        </Reveal>
        <Reveal delay={1}>
          <Heading level={1} nativeID="hero-h" style={styles.headline}>
            {HERO.headlineLine1}
            {"\n"}
            <Text style={styles.headlineAccent}>{HERO.headlineLine2}</Text>
          </Heading>
        </Reveal>
        <Reveal delay={2} style={styles.leadWrap}>
          <Text style={styles.lead}>{HERO.lead}</Text>
        </Reveal>
        <Reveal delay={3} style={styles.ctaWrap}>
          <View style={styles.ctaRow}>
            <CtaButton
              href={SITE.testFlightUrl}
              label={HERO.primaryCta}
              variant="primary"
              target="_blank"
              rel="noopener noreferrer"
            />
            <CtaButton
              href={SITE.repoUrl}
              label={HERO.secondaryCta}
              variant="secondary"
              target="_blank"
              rel="noopener noreferrer"
            />
          </View>
        </Reveal>
        <Reveal delay={3}>
          <View style={styles.metaRow}>
            {HERO.meta.map((item, idx) => (
              <View key={item} style={styles.metaItem}>
                {idx > 0 ? <View style={styles.dot} /> : null}
                <Text style={styles.metaText}>{item}</Text>
              </View>
            ))}
          </View>
        </Reveal>
      </View>
    </View>
  );
}

const styles = webStyles({
  hero: {
    position: "relative",
    minHeight: "calc(100vh - 56px)",
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxxl,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  wash: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 0,
    overflow: "hidden",
    backgroundImage: "linear-gradient(180deg, #23272e 0%, #1b1e24 50%, #0e1014 100%)",
  },
  cells: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  },
  floor: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    bottom: 0,
    backgroundImage:
      "linear-gradient(180deg, rgba(14,16,20,0) 0%, rgba(14,16,20,0.55) 60%, #1e2227 100%)",
  },
  inner: {
    position: "relative",
    zIndex: 1,
    alignSelf: "center",
    maxWidth: 980,
    width: "100%",
    paddingHorizontal: GUTTER,
    alignItems: "center",
  },
  headline: {
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  headlineAccent: {
    backgroundImage: "linear-gradient(180deg, #d7dae0 0%, #abb2bf 130%)",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "transparent",
  },
  leadWrap: {
    alignItems: "center",
    width: "100%",
  },
  lead: {
    fontSize: "clamp(18px, 1.5vw, 22px)",
    color: colors.textSecondary,
    lineHeight: "1.45",
    maxWidth: "56ch",
    textAlign: "center",
  },
  ctaWrap: {
    width: "100%",
    alignItems: "center",
    marginTop: spacing.xl,
  },
  ctaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "center",
  },
  metaRow: {
    marginTop: spacing.xl,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },
  metaText: {
    fontSize: 13,
    color: colors.textMuted,
  },
});
