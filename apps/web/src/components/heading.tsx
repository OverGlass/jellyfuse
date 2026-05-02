import { Text, type TextProps } from "react-native";
import { colors, fontWeight } from "@jellyfuse/theme";

import { webStyles } from "./web-styles";

type Level = 1 | 2 | 3 | 4;

type Props = TextProps & {
  level: Level;
  children: React.ReactNode;
};

// Semantic heading. RNW maps `accessibilityRole="header" + aria-level=N`
// to the corresponding `<hN>` element so the static export contains real
// h1–h4 tags for SEO. The marketing type ramp uses CSS `clamp()` strings,
// passed through RNW's style serializer.
export function Heading({ level, style, children, ...rest }: Props) {
  return (
    <Text
      accessibilityRole="header"
      aria-level={level}
      style={[styles.base, levelStyles[level], style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

const baseFamily = '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif';

const styles = webStyles({
  base: {
    fontFamily: baseFamily,
    color: colors.textPrimary,
    margin: 0,
    // The marketing copy uses `\n` to split a heading into two display
    // lines (e.g. "One Jellyfin client.\nEvery screen."). Browsers
    // collapse runs of whitespace by default, so we need `pre-line` to
    // preserve those newlines while still letting the rest of the text
    // wrap normally.
    whiteSpace: "pre-line",
  },
});

const levelStyles = webStyles({
  1: {
    fontSize: "clamp(48px, 6.5vw, 96px)",
    fontWeight: fontWeight.bold,
    letterSpacing: "-0.035em",
    lineHeight: 1.05,
  },
  2: {
    fontSize: "clamp(36px, 4.5vw, 64px)",
    fontWeight: fontWeight.semibold,
    letterSpacing: "-0.025em",
    lineHeight: 1.05,
  },
  3: {
    fontSize: "clamp(22px, 2vw, 28px)",
    fontWeight: fontWeight.semibold,
    letterSpacing: "-0.01em",
    lineHeight: 1.15,
  },
  4: {
    fontSize: 17,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.01 * 17,
    lineHeight: 17 * 1.3,
  },
});
