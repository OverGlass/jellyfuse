import { colors, opacity, radius, withAlpha } from "@jellyfuse/theme";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScreenGutters } from "@/services/responsive";
import { NerdIcon } from "./nerd-icon";

/**
 * Floating circular back button overlaid on the top-left of a screen.
 * Uses the live safe-area inset + `useScreenGutters()` so it respects
 * the notch / Dynamic Island in both portrait and landscape.
 *
 * Calls `router.back()` if there's somewhere to go; falls back to the
 * root `/` otherwise so a direct-link entry point doesn't strand the
 * user. Pure component: zero state, one callback path.
 */
export function BackButton() {
  const insets = useSafeAreaInsets();
  const gutters = useScreenGutters();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 8, left: gutters.left }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={12}
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace("/");
          }
        }}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <NerdIcon name="chevronLeft" size={18} />
      </Pressable>
    </View>
  );
}

const BUTTON_SIZE = 36;

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    zIndex: 10,
  },
  button: {
    alignItems: "center",
    backgroundColor: withAlpha(colors.black, opacity.alpha50),
    borderRadius: radius.full,
    height: BUTTON_SIZE,
    justifyContent: "center",
    width: BUTTON_SIZE,
  },
  buttonPressed: {
    opacity: opacity.pressed,
  },
});
