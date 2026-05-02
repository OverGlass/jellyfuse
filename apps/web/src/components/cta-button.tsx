import { Text } from "react-native";
import { colors, fontWeight, radius } from "@jellyfuse/theme";

import { TextLink } from "./text-link";
import { webStyles } from "./web-styles";

type CtaVariant = "primary" | "secondary";

type CtaButtonProps = {
  href: string;
  label: string;
  variant?: CtaVariant;
  target?: string;
  rel?: string;
};

// Pill button used in the hero. Two variants: primary (text-on-light) and
// secondary (transparent, faint border). Renders as an <a> via TextLink so
// crawlers see a real link, not a JS-only handler.
export function CtaButton({ href, label, variant = "primary", target, rel }: CtaButtonProps) {
  const variantStyle = variant === "primary" ? styles.primary : styles.secondary;
  const variantText = variant === "primary" ? styles.primaryText : styles.secondaryText;
  const isExternal = href.startsWith("http");
  const linkTarget = target ?? (isExternal ? "_blank" : undefined);
  const linkRel = rel ?? (isExternal ? "noopener noreferrer" : undefined);
  return (
    <TextLink
      href={href}
      target={linkTarget}
      rel={linkRel}
      style={[styles.btn, variantStyle, variantText]}
    >
      <Text style={[styles.label, variantText]}>{label}</Text>
    </TextLink>
  );
}

const styles = webStyles({
  btn: {
    borderRadius: radius.full,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: "transparent",
    fontWeight: fontWeight.semibold,
    transitionProperty: "transform, background-color, border-color, color",
    transitionDuration: "200ms",
    cursor: "pointer",
  },
  primary: {
    backgroundColor: colors.textPrimary,
  },
  primaryText: {
    color: colors.accentContrast,
  },
  secondary: {
    backgroundColor: "transparent",
    borderColor: "rgba(215,218,224,0.22)",
  },
  secondaryText: {
    color: colors.textPrimary,
  },
  label: {
    fontSize: 15,
    fontWeight: fontWeight.semibold,
    lineHeight: 16,
  },
});
