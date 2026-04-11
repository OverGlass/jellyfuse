import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { Pressable, StyleSheet, Text } from "react-native";

/**
 * Circular "×" dismiss button used in modal `AuthScreenHeader`
 * `rightAction` slots (profile picker, add-user flow). Pure component —
 * `onPress` out, no state in.
 */
interface Props {
  onPress: () => void;
}

export function CloseButton({ onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <Text style={styles.glyph}>×</Text>
    </Pressable>
  );
}

const BUTTON_SIZE = 36;

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    height: BUTTON_SIZE,
    justifyContent: "center",
    marginLeft: spacing.md,
    width: BUTTON_SIZE,
  },
  buttonPressed: {
    opacity: opacity.pressed,
  },
  glyph: {
    color: colors.textSecondary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.medium,
    lineHeight: fontSize.subtitle,
  },
});
