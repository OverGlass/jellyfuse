import { colors, spacing } from "@jellyfuse/theme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PILL_HEIGHT = 64;
const PILL_RADIUS = PILL_HEIGHT / 2;
const ICON_SIZE = 26;

/**
 * Extra bottom padding (dp) for scroll containers so the last item
 * stays visible above the floating pill. Add `insets.bottom` on top.
 */
export const PILL_TAB_CLEARANCE = PILL_HEIGHT + spacing.md;

/**
 * Floating pill-shaped tab bar, centered at the bottom of the screen
 * with symmetric side margins. Tabs are evenly distributed (`flex: 1`)
 * for generous tap targets. Profile switching lives in Settings, so the
 * bar is pure navigation — no avatar row.
 */
export function PillTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  const bottomOffset = insets.bottom > 0 ? insets.bottom - 4 : spacing.sm;
  const sideOffset = spacing.md;

  return (
    <View
      style={[
        styles.wrapper,
        {
          bottom: bottomOffset,
          left: (insets.left ?? 0) + sideOffset,
          right: (insets.right ?? 0) + sideOffset,
        },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.pill}>
        <BlurView tint="dark" intensity={90} style={StyleSheet.absoluteFill} />

        <View style={styles.items}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            if (route.name === "index") return null;

            const isFocused = state.index === index;

            function handlePress() {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            }

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityLabel={options.title ?? route.name}
                accessibilityState={{ selected: isFocused }}
                onPress={handlePress}
                hitSlop={8}
                style={({ pressed }) => [styles.tabItem, pressed && styles.itemPressed]}
              >
                {options.tabBarIcon?.({
                  focused: isFocused,
                  color: isFocused ? colors.accent : colors.textMuted,
                  size: ICON_SIZE,
                })}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    zIndex: 50,
  },
  pill: {
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: PILL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    height: PILL_HEIGHT,
    overflow: "hidden",
  },
  items: {
    alignItems: "stretch",
    flexDirection: "row",
    height: PILL_HEIGHT,
  },
  tabItem: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  itemPressed: {
    opacity: 0.6,
  },
});
