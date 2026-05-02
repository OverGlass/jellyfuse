import { Text, View } from "react-native";
import { colors, fontWeight, spacing } from "@jellyfuse/theme";

import { CodecChip } from "../components/codec-chip";
import { Eyebrow } from "../components/eyebrow";
import { Heading } from "../components/heading";
import { Reveal } from "../components/reveal";
import { Section } from "../components/section";
import { webStyles } from "../components/web-styles";
import { PLAYER } from "../lib/content";

// Full-bleed band on `--surface`. Giant gradient-clipped numeral on the
// left, headline + chip rail on the right.
export function OnePlayer() {
  return (
    <Section bordered="both" padding="lg" background={colors.surface}>
      <View style={styles.grid}>
        <Reveal>
          <Text accessibilityElementsHidden style={styles.num}>
            {PLAYER.numeral}
          </Text>
        </Reveal>
        <View style={styles.copyCol}>
          <Reveal>
            <Eyebrow>{PLAYER.eyebrow}</Eyebrow>
          </Reveal>
          <Reveal delay={1}>
            <Heading level={2} style={styles.headline}>
              {PLAYER.headlineLine1}
              {"\n"}
              {PLAYER.headlineLine2}
            </Heading>
          </Reveal>
          <Reveal delay={2}>
            <Text style={styles.lead}>{PLAYER.lead}</Text>
          </Reveal>
          <Reveal delay={3}>
            <View aria-label="Supported formats" style={styles.chipRail}>
              {PLAYER.chips.map((chip) => (
                <CodecChip key={chip.label} label={chip.label} strong={chip.strong} />
              ))}
            </View>
          </Reveal>
        </View>
      </View>
    </Section>
  );
}

const styles = webStyles({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "clamp(32px, 6vw, 80px)",
    alignItems: "center",
  },
  num: {
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
    fontSize: "clamp(160px, 22vw, 320px)",
    fontWeight: fontWeight.bold,
    lineHeight: "0.85",
    letterSpacing: "-0.06em",
    backgroundImage: `linear-gradient(180deg, ${colors.textPrimary}, ${colors.accent} 130%)`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "transparent",
    paddingRight: spacing.lg,
  },
  copyCol: {
    flex: 1,
    minWidth: 260,
  },
  headline: {
    marginBottom: spacing.md,
    maxWidth: "18ch",
  },
  lead: {
    fontSize: "clamp(18px, 1.5vw, 22px)",
    color: colors.textSecondary,
    lineHeight: "1.45",
    maxWidth: "56ch",
  },
  chipRail: {
    marginTop: spacing.xl,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
});
