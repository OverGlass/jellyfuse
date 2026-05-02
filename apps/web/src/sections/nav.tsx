import { Image, Text, View } from "react-native";
import { colors, fontWeight } from "@jellyfuse/theme";

import { CONTAINER_MAX_WIDTH, GUTTER, HAIRLINE } from "../components/layout";
import { TextLink } from "../components/text-link";
import { webStyles } from "../components/web-styles";
import { NAV_LINKS, SITE } from "../lib/content";
import { useNavScroll } from "../lib/use-nav-scroll";

// Sticky navbar. Transparent at the top of the page, opaque + blur once
// the user scrolls past 8px. Mirrors the prototype's `.nav.is-scrolled`
// pattern.
export function Nav() {
  const scrolled = useNavScroll();
  return (
    <View
      aria-label="Site"
      style={[
        styles.nav,
        {
          position: "sticky",
          top: 0,
          zIndex: 100,
          transitionProperty: "background-color, backdrop-filter, border-color",
          transitionDuration: "200ms",
        },
        scrolled
          ? {
              backgroundColor: "rgba(30,34,39,0.72)",
              backdropFilter: "saturate(180%) blur(20px)",
              WebkitBackdropFilter: "saturate(180%) blur(20px)",
              borderBottomWidth: 1,
              borderBottomColor: HAIRLINE,
            }
          : null,
      ]}
    >
      <View style={styles.inner}>
        <TextLink href="#top" aria-label={SITE.name} style={styles.brand}>
          <Image source={require("../../public/icon.png")} style={styles.brandMark} />
          <Text style={styles.brandText}> {SITE.name}</Text>
        </TextLink>
        <View aria-label="Primary" style={styles.linksRow}>
          {NAV_LINKS.map((link) => (
            <TextLink key={link.href} href={link.href} style={styles.navLink}>
              {link.label}
            </TextLink>
          ))}
          <TextLink
            href={SITE.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.navCta}
          >
            GitHub
          </TextLink>
        </View>
      </View>
    </View>
  );
}

const styles = webStyles({
  nav: {
    width: "100%",
    backgroundColor: "transparent",
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
  },
  inner: {
    height: 56,
    width: "100%",
    maxWidth: CONTAINER_MAX_WIDTH,
    marginHorizontal: "auto",
    paddingHorizontal: GUTTER,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    color: colors.textPrimary,
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
    fontSize: 18,
    fontWeight: fontWeight.semibold,
    letterSpacing: "-0.01em",
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 7,
    objectFit: "cover",
  },
  brandText: {
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
    fontSize: 18,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    letterSpacing: "-0.01em",
  },
  linksRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: "clamp(16px, 2.5vw, 36px)",
  },
  navLink: {
    fontSize: 14,
    color: colors.textSecondary,
    paddingVertical: 6,
  },
  navCta: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 9999,
    backgroundColor: colors.textPrimary,
    color: colors.accentContrast,
    fontWeight: fontWeight.semibold,
    fontSize: 14,
  },
});
