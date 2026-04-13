import { Host, TextField, type TextFieldRef } from "@expo/ui/swift-ui";
import { glassEffect } from "@expo/ui/swift-ui/modifiers";
import { colors, fontSize, opacity, radius, spacing } from "@jellyfuse/theme";
import { useRef } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInput as RNTextInput,
} from "react-native";
import { NerdIcon } from "@/features/common/components/nerd-icon";

/**
 * Search input field used at the top of the search screen.
 *
 * On iOS, renders a SwiftUI `TextField` from `@expo/ui/swift-ui`
 * wrapped in a `Host`, with the iOS 26 Liquid Glass effect applied
 * via the `glassEffect` modifier (capsule shape). The modifier is a
 * no-op on iOS < 26 — the field still renders as a regular SwiftUI
 * `TextField`. The SwiftUI text field is uncontrolled by design;
 * we hold an imperative `TextFieldRef` so the trailing clear button
 * can call `setText("")` instead of fighting the React state model.
 *
 * On Android (and any non-iOS host), falls back to a plain
 * `TextInput` styled with the existing surface tokens — same
 * surface and corner radius as before.
 *
 * Pure component: props in / callbacks out. The screen owns the
 * input string and forwards both `onChangeText` and `onClear`.
 */
interface Props {
  value: string;
  placeholder?: string;
  onChangeText: (next: string) => void;
  onClear: () => void;
  /** Auto-focus on mount. Defaults to `true`. */
  autoFocus?: boolean;
}

const PLACEHOLDER_DEFAULT = "Search movies and TV shows";

export function SearchInput({
  value,
  placeholder = PLACEHOLDER_DEFAULT,
  onChangeText,
  onClear,
  autoFocus = true,
}: Props) {
  const showClear = value.length > 0;
  const swiftRef = useRef<TextFieldRef>(null);
  const rnRef = useRef<RNTextInput>(null);

  function handleClearPress() {
    if (Platform.OS === "ios") {
      void swiftRef.current?.setText("");
    } else {
      rnRef.current?.clear();
    }
    onClear();
  }

  return (
    <View style={styles.row}>
      <View style={styles.inputArea}>
        {Platform.OS === "ios" ? (
          <Host matchContents style={styles.host}>
            <TextField
              ref={swiftRef}
              defaultValue={value}
              placeholder={placeholder}
              onValueChange={onChangeText}
              autoFocus={autoFocus}
              modifiers={[
                // Liquid Glass on iOS 26+, no-op on older iOS — the
                // SwiftUI `TextField` falls back to its default style
                // automatically. Capsule shape matches the rounded
                // search-pill look used elsewhere in the app.
                glassEffect({
                  glass: { variant: "regular", interactive: true },
                  shape: "capsule",
                }),
              ]}
            />
          </Host>
        ) : (
          <View style={styles.fallback}>
            <NerdIcon name="search" size={16} color={colors.textMuted} />
            <TextInput
              ref={rnRef}
              accessibilityLabel="Search"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={autoFocus}
              keyboardAppearance="dark"
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              selectionColor={colors.accent}
              style={styles.fallbackInput}
              value={value}
            />
          </View>
        )}
      </View>
      {showClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
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

const HEIGHT = 44;

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  inputArea: {
    flex: 1,
    height: HEIGHT,
    justifyContent: "center",
  },
  host: {
    flex: 1,
  },
  fallback: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.sm,
    height: HEIGHT,
    paddingHorizontal: spacing.md,
  },
  fallbackInput: {
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
