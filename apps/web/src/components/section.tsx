import { View, type ViewProps } from "react-native";

import { CONTAINER_MAX_WIDTH, GUTTER, HAIRLINE } from "./layout";
import { webStyles } from "./web-styles";

type Padding = "none" | "sm" | "md" | "lg";

type Props = ViewProps & {
  padding?: Padding;
  bordered?: "top" | "bottom" | "both" | undefined;
  background?: string;
  fullBleed?: boolean;
  children: React.ReactNode;
};

// Section wrapper. Owns vertical rhythm + optional hairline borders so
// section files don't have to repeat the layout boilerplate.
//
// `fullBleed=true` lets the section background extend edge-to-edge while
// the inner content is still centred via the same gutter clamp.
export function Section({
  padding = "lg",
  bordered,
  background,
  fullBleed = false,
  style,
  children,
  ...rest
}: Props) {
  const padStyle =
    padding === "none"
      ? null
      : padding === "sm"
        ? styles.padSm
        : padding === "md"
          ? styles.padMd
          : styles.padLg;
  const borderStyles =
    bordered === "top"
      ? styles.borderTop
      : bordered === "bottom"
        ? styles.borderBottom
        : bordered === "both"
          ? styles.borderBoth
          : null;
  return (
    <View
      style={[
        styles.section,
        background ? { backgroundColor: background } : null,
        borderStyles,
        style,
      ]}
      {...rest}
    >
      <View style={[fullBleed ? styles.fullBleed : styles.container, padStyle]}>{children}</View>
    </View>
  );
}

const styles = webStyles({
  section: {
    position: "relative",
    width: "100%",
  },
  container: {
    maxWidth: CONTAINER_MAX_WIDTH,
    width: "100%",
    marginHorizontal: "auto",
    paddingHorizontal: GUTTER,
  },
  fullBleed: {
    width: "100%",
  },
  padSm: {
    paddingTop: "clamp(48px, 7vw, 96px)",
    paddingBottom: "clamp(48px, 7vw, 96px)",
  },
  padMd: {
    paddingTop: "clamp(56px, 8vw, 112px)",
    paddingBottom: "clamp(56px, 8vw, 112px)",
  },
  padLg: {
    paddingTop: "clamp(64px, 10vw, 144px)",
    paddingBottom: "clamp(64px, 10vw, 144px)",
  },
  borderTop: {
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  borderBottom: {
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  borderBoth: {
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
});
