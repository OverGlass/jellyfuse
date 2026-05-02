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
              <View style={styles.cardWrap}>
                <FeatureCard title={card.title} body={card.body} icon={card.icon} />
              </View>
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
  // CSS Grid with `auto-fit minmax(260px, 1fr)` reproduces the
  // prototype's 3 / 2 / 1 column responsive behaviour without media
  // queries: cards stretch to the same row height (grid items default
  // to `align-items: stretch`) and the orphan ninth card no longer
  // expands to fill its own row, which is what the flex-wrap version
  // was doing.
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: spacing.md,
  },
  gridItem: {
    // Grid items shouldn't carry flex sizing — let the grid layout
    // own the column width. The wrapping Reveal still owns the fade-up
    // animation; we add a flex column inside so the FeatureCard child
    // grows to the height of the tallest cell in the row.
    minWidth: 0,
    height: "100%",
  },
  cardWrap: {
    flex: 1,
    height: "100%",
  },
});
