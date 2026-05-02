import { View } from "react-native";
import { spacing } from "@jellyfuse/theme";

import { Eyebrow } from "../components/eyebrow";
import { FaqItem } from "../components/faq-item";
import { Heading } from "../components/heading";
import { Reveal } from "../components/reveal";
import { Section } from "../components/section";
import { HAIRLINE } from "../components/layout";
import { webStyles } from "../components/web-styles";
import { FAQ } from "../lib/content";

// Two-column layout: lead column with section title, content column with
// the disclosure list. Disclosures are accessible (`aria-expanded`) and
// keyboard-operable.
export function Faq() {
  return (
    <Section padding="lg" bordered="top" nativeID="faq">
      <View style={styles.grid}>
        <View style={styles.headCol}>
          <Reveal>
            <Eyebrow>{FAQ.eyebrow}</Eyebrow>
          </Reveal>
          <Reveal delay={1}>
            <Heading level={2}>{FAQ.headline}</Heading>
          </Reveal>
        </View>
        <Reveal delay={1} style={styles.listCol}>
          <View style={styles.list}>
            {FAQ.items.map((item) => (
              <FaqItem key={item.q} question={item.q} answer={item.a} />
            ))}
          </View>
        </Reveal>
      </View>
    </Section>
  );
}

const styles = webStyles({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "clamp(32px, 6vw, 96px)",
    alignItems: "flex-start",
  },
  headCol: {
    width: 320,
    flex: 0,
    minWidth: 260,
  },
  listCol: {
    flex: 1,
    minWidth: 280,
  },
  list: {
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    marginTop: spacing.md,
  },
});
