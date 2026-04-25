import { NerdIcon } from "@/features/common/components/nerd-icon";
import { colors, fontSize, opacity, radius, spacing, withAlpha } from "@jellyfuse/theme";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard, Pressable, StyleSheet, TextInput, View } from "react-native";

/**
 * Search input field used on the home screen and shelf grid screens.
 * Pure component — props in / callbacks out.
 *
 * Implementation note: we previously tried `@expo/ui/swift-ui` so we
 * could pick up the iOS 26 Liquid Glass effect, but the SwiftUI
 * `TextField` is unresponsive under Mac Catalyst (the keyboard never
 * fires). Sticking with `react-native`'s `TextInput` keeps every
 * platform we target (iPhone, iPad, Catalyst, Android) on the same
 * code path with no platform `if`s.
 */
interface Props {
  value: string;
  placeholder?: string;
  onChangeText: (next: string) => void;
  onClear: () => void;
  /** Auto-focus on mount. Defaults to `false`. */
  autoFocus?: boolean;
}

export function SearchInput({
  value,
  placeholder,
  onChangeText,
  onClear,
  autoFocus = false,
}: Props) {
  const { t } = useTranslation();
  const showClear = value.length > 0;
  const inputRef = useRef<TextInput>(null);

  function handleClearPress() {
    inputRef.current?.clear();
    // Tapping the clear chip should fully reset the search affordance,
    // including dismissing the keyboard. `TextInput.clear()` only wipes
    // the value — focus and the IME stay up otherwise.
    Keyboard.dismiss();
    onClear();
  }

  return (
    <View style={styles.root}>
      <NerdIcon name="search" size={16} color={colors.textMuted} />
      <TextInput
        ref={inputRef}
        accessibilityLabel={t("search.input.ariaLabel")}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        keyboardAppearance="dark"
        onChangeText={onChangeText}
        placeholder={placeholder ?? t("search.input.placeholder")}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        selectionColor={colors.accent}
        style={styles.input}
        value={value}
      />
      {showClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("search.input.clearAriaLabel")}
          hitSlop={12}
          onPress={handleClearPress}
          style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
        >
          <NerdIcon name="close" size={12} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: withAlpha(colors.surface, 0.5),
    borderRadius: radius.full,
    flexDirection: "row",
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: fontSize.body,
    paddingVertical: 0,
  },
  clear: {
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  clearPressed: {
    opacity: opacity.pressed,
  },
});
