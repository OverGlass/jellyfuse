import { useAuth } from "@/services/auth/state";
import { colors, duration, profileColorFor, radius, spacing } from "@jellyfuse/theme";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const PILL_HEIGHT = 60;
const PILL_RADIUS = PILL_HEIGHT / 2; // 30 — fully rounded pill ends
const AVATAR_SIZE = 34;

/**
 * Extra bottom padding (dp) for scroll containers so the last item
 * stays visible above the floating pill. Add `insets.bottom` on top.
 * Mirrors Rust `TAB_BAR_SCROLL_INSET = 92`.
 */
export const PILL_TAB_CLEARANCE = 76; // pill 60 + gap 8 + breathing 8

/**
 * Floating pill-shaped tab bar anchored to the **bottom-right** corner,
 * mirroring the Rust mobile `tab_bar.rs` design:
 * - `BlurView tint="dark"` clipped by `overflow:hidden`.
 * - Semi-transparent dark overlay (`rgba(30,30,30,0.85)`) over the blur.
 * - Hairline white border at 12% opacity, `borderRadius: 30`.
 * - Right-aligned, `spacing.lg` from the right edge + safe-area inset.
 *
 * Ends with an avatar button that opens the profile-picker modal so
 * users can switch profiles without leaving the current tab.
 */
export function PillTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { activeUser } = useAuth();

  // Rust: bottom = safe_area_bottom > 0 ? safe_area_bottom - 8 : 8
  const bottomOffset = insets.bottom > 0 ? insets.bottom - 8 : 8;
  const rightOffset = (insets.right ?? 0) + spacing.lg;

  function handleAvatarPress() {
    router.push("/profile-picker");
  }

  const avatarBg = profileColorFor(activeUser?.userId ?? "anonymous");
  const avatarInitial = (activeUser?.displayName ?? "?").slice(0, 1).toUpperCase();

  return (
    <View style={[styles.wrapper, { bottom: bottomOffset, right: rightOffset }]}>
      <View style={styles.pill}>
        {/* Blur fill clipped to pill shape by overflow:hidden */}
        <BlurView tint="dark" intensity={90} style={StyleSheet.absoluteFill} />

        <View style={styles.items}>
          {/* Nav tabs */}
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
                style={({ pressed }) => [styles.tabItem, pressed && styles.itemPressed]}
              >
                {options.tabBarIcon?.({
                  focused: isFocused,
                  color: isFocused ? colors.accent : colors.textMuted,
                  size: 22,
                })}
              </Pressable>
            );
          })}

          {/* Divider */}
          <View style={styles.divider} />

          {/* Avatar / profile-switcher */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Switch profile (${activeUser?.displayName ?? "user"})`}
            onPress={handleAvatarPress}
            style={({ pressed }) => [styles.tabItem, pressed && styles.itemPressed]}
          >
            <View style={[styles.avatar, !activeUser?.avatarUrl && { backgroundColor: avatarBg }]}>
              {activeUser?.avatarUrl ? (
                <Image
                  source={activeUser.avatarUrl}
                  style={styles.avatarImage}
                  contentFit="cover"
                  transition={duration.normal}
                  recyclingKey={activeUser.avatarUrl}
                  cachePolicy="memory-disk"
                />
              ) : (
                <Text style={styles.avatarInitial}>{avatarInitial}</Text>
              )}
            </View>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    // zIndex above content, below full-screen modals/player.
    zIndex: 50,
  },
  pill: {
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: PILL_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    height: PILL_HEIGHT,
    // Clips BlurView and overlay to the pill shape.
    overflow: "hidden",
  },
  items: {
    alignItems: "center",
    flexDirection: "row",
    height: PILL_HEIGHT,
    paddingHorizontal: spacing.sm,
  },
  tabItem: {
    alignItems: "center",
    height: PILL_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  itemPressed: {
    opacity: 0.6,
  },
  divider: {
    backgroundColor: "rgba(255,255,255,0.15)",
    height: 28,
    marginHorizontal: spacing.xs,
    width: StyleSheet.hairlineWidth,
  },
  avatar: {
    alignItems: "center",
    borderRadius: radius.full,
    height: AVATAR_SIZE,
    justifyContent: "center",
    overflow: "hidden",
    width: AVATAR_SIZE,
  },
  avatarImage: {
    height: AVATAR_SIZE,
    width: AVATAR_SIZE,
  },
  avatarInitial: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "600",
  },
});
