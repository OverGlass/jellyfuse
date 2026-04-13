// NerdIcon — renders a FontAwesome codepoint from the JetBrainsMono
// Nerd Font. Wraps <Text> so consumers can override color, size,
// opacity, etc. via the usual Text style props.
//
// Default size tracks `fontSize.bodyLarge` and default color is
// `colors.textPrimary`, so icons look consistent with body text
// unless explicitly themed.

import { colors, fontFamily, fontSize, icons, type IconName } from "@jellyfuse/theme";
import { StyleSheet, Text, type TextProps, type TextStyle } from "react-native";

export interface NerdIconProps extends Omit<TextProps, "children"> {
  name: IconName;
  size?: number;
  color?: string;
  style?: TextStyle | TextStyle[];
}

export function NerdIcon({
  name,
  size = fontSize.bodyLarge,
  color = colors.textPrimary,
  style,
  ...rest
}: NerdIconProps) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.base, { fontSize: size, lineHeight: size * 1.2, color }, style]}
      {...rest}
    >
      {icons[name]}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: fontFamily.icon,
    includeFontPadding: false,
    textAlign: "center",
    textAlignVertical: "center",
  },
});
