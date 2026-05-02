import { Image, Text, View } from "react-native";
import { colors, fontWeight, spacing } from "@jellyfuse/theme";

import { Section } from "../components/section";
import { TextLink } from "../components/text-link";
import { HAIRLINE } from "../components/layout";
import { webStyles } from "../components/web-styles";
import { FOOTER, SITE } from "../lib/content";

export function Footer() {
  return (
    <Section padding="md" bordered="top">
      <View style={styles.grid}>
        <View style={styles.brandCol}>
          <TextLink href="#top" style={styles.brand}>
            <Image source={require("../../public/icon.png")} style={styles.brandMark} />
            <Text style={styles.brandText}>{SITE.name}</Text>
          </TextLink>
          <Text style={styles.blurb}>{FOOTER.blurb}</Text>
        </View>
        {FOOTER.columns.map((col) => (
          <View key={col.title} style={styles.linkCol}>
            <Text style={styles.colTitle}>{col.title}</Text>
            {col.links.map((link) => {
              const isExternal = link.href.startsWith("http");
              return (
                <TextLink
                  key={link.label}
                  href={link.href}
                  target={isExternal ? "_blank" : undefined}
                  rel={isExternal ? "noopener noreferrer" : undefined}
                  style={styles.colLink}
                >
                  {link.label}
                </TextLink>
              );
            })}
          </View>
        ))}
      </View>
      <View style={styles.fine}>
        <Text style={styles.fineText}>{FOOTER.fineLeft}</Text>
        <Text style={styles.fineText}>{FOOTER.fineRight}</Text>
      </View>
    </Section>
  );
}

const styles = webStyles({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xl,
  },
  brandCol: {
    flex: 2,
    minWidth: 240,
  },
  brand: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    color: colors.textPrimary,
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
    fontSize: 18,
    fontWeight: fontWeight.semibold,
    letterSpacing: "-0.01em",
    textDecorationLine: "none",
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 7,
    verticalAlign: "middle",
  },
  brandText: {
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
    fontSize: 18,
    lineHeight: "1",
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    letterSpacing: "-0.01em",
  },
  blurb: {
    marginTop: spacing.md,
    maxWidth: "36ch",
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: "1.5",
  },
  linkCol: {
    flex: 1,
    minWidth: 140,
  },
  colTitle: {
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
    fontSize: 13,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    textTransform: "uppercase",
    letterSpacing: 0.1 * 13,
    marginBottom: spacing.md,
  },
  colLink: {
    fontSize: 14,
    color: colors.textSecondary,
    paddingVertical: 4,
  },
  fine: {
    marginTop: spacing.xxl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  fineText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
