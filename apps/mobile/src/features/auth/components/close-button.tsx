import { colors, opacity, radius, spacing } from "@jellyfuse/theme";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet } from "react-native";
import { NerdIcon } from "@/features/common/components/nerd-icon";

/**
 * Circular "×" dismiss button used in modal `AuthScreenHeader`
 * `rightAction` slots (profile picker, add-user flow). Pure component —
 * `onPress` out, no state in.
 */
interface Props {
  onPress: () => void;
}

export function CloseButton({ onPress }: Props) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("common.close")}
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
    >
      <NerdIcon name="close" size={16} color={colors.textSecondary} />
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
});
