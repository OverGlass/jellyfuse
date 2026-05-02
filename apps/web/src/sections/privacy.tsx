import { Text, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { colors, fontWeight, radius, spacing } from "@jellyfuse/theme";

import { Eyebrow } from "../components/eyebrow";
import { Heading } from "../components/heading";
import { Reveal } from "../components/reveal";
import { Section } from "../components/section";
import { HAIRLINE } from "../components/layout";
import { webStyles } from "../components/web-styles";
import { PRIVACY } from "../lib/content";

// Two-card row — privacy + open source. Cards sit on `--surface` with a
// faint accent radial in the top-right corner.
export function Privacy() {
  return (
    <Section padding="lg" bordered="top">
      <Reveal>
        <Eyebrow tone="accent">{PRIVACY.eyebrow}</Eyebrow>
      </Reveal>
      <View style={styles.grid}>
        {PRIVACY.cards.map((card, idx) => (
          <Reveal key={card.title} delay={idx === 0 ? 0 : 1} style={styles.card}>
            <View style={styles.cardWrap}>
              <View style={styles.cardGlow} />
              <View style={styles.iconWrap}>{idx === 0 ? <ShieldIcon /> : <CodeIcon />}</View>
              <Heading level={3} style={styles.cardTitle}>
                {card.title}
              </Heading>
              <Text style={styles.cardBody}>{card.body}</Text>
            </View>
          </Reveal>
        ))}
      </View>
    </Section>
  );
}

function ShieldIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2L4 6v6c0 5 3.5 8.5 8 10c4.5-1.5 8-5 8-10V6z"
        stroke={colors.accent}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path
        d="M9 12l2 2l4-4"
        stroke={colors.accent}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CodeIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7h16M4 12h16M4 17h10"
        stroke={colors.accent}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Circle cx={18} cy={17} r={3} stroke={colors.accent} strokeWidth={1.6} />
    </Svg>
  );
}

const styles = webStyles({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  card: {
    flex: 1,
    minWidth: 280,
  },
  cardWrap: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: radius.lg,
    padding: "clamp(28px, 4vw, 48px)",
    position: "relative",
    overflow: "hidden",
  },
  cardGlow: {
    position: "absolute",
    top: "-40%",
    right: "-20%",
    width: "60%",
    height: "80%",
    backgroundImage: "radial-gradient(circle, rgba(97,175,239,0.10), transparent 60%)",
    pointerEvents: "none",
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  cardTitle: {
    fontSize: 28,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.md,
    letterSpacing: "-0.02em",
  },
  cardBody: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: "1.5",
    maxWidth: "42ch",
  },
});
