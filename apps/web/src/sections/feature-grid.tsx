import { Text, View } from "react-native";
import { colors, spacing } from "@jellyfuse/theme";

import { Eyebrow } from "../components/eyebrow";
import { FeatureCard } from "../components/feature-card";
import { Heading } from "../components/heading";
import { Reveal } from "../components/reveal";
import { Section } from "../components/section";
import { webStyles } from "../components/web-styles";
import { FEATURES } from "../lib/content";

// 3×3 grid of small feature cards. Wraps to 2 cols at <880px and 1 col
// at <540px via `flexWrap` + `minWidth` on the grid items.
export function FeatureGrid() {
  return (
    <Section padding="lg" nativeID="features">
      <Reveal style={styles.head}>
        <Eyebrow>{FEATURES.eyebrow}</Eyebrow>
        <Heading level={2} style={styles.headline}>
          {FEATURES.headline}
        </Heading>
        <Text style={styles.lead}>{FEATURES.lead}</Text>
      </Reveal>

      <View style={styles.grid}>
        {FEATURES.cards.map((card, idx) => {
          const delay = (idx % 3) as 0 | 1 | 2;
          return (
            <Reveal key={card.title} delay={delay} style={styles.gridItem}>
              <FeatureCard title={card.title} body={card.body} icon={card.icon} />
            </Reveal>
          );
        })}
      </View>
    </Section>
  );
}

const styles = webStyles({
  head: {
    alignItems: "center",
    maxWidth: 720,
    alignSelf: "center",
    marginBottom: spacing.xxxl,
    width: "100%",
  },
  headline: {
    textAlign: "center",
  },
  lead: {
    fontSize: "clamp(18px, 1.5vw, 22px)",
    color: colors.textSecondary,
    lineHeight: "1.45",
    textAlign: "center",
    marginTop: spacing.md,
    maxWidth: "56ch",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  gridItem: {
    flex: 1,
    minWidth: 260,
  },
});
