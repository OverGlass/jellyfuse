import {
  colors,
  duration,
  fontSize,
  fontWeight,
  opacity,
  profileColorFor,
  radius,
  type IconName,
} from "@jellyfuse/theme";
import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NerdIcon } from "./nerd-icon";

const APP_ICON = require("../../../../assets/images/icon.png") as number;

export const SIDEBAR_WIDTH_EXPANDED = 264;
export const SIDEBAR_WIDTH_COLLAPSED = 72;

export interface SidebarRoute {
  name: string;
  label: string;
  icon: IconName;
}

export interface SidebarUser {
  userId: string;
  displayName: string;
}

interface Props {
  activeRouteName: string;
  collapsed: boolean;
  routes: SidebarRoute[];
  user: SidebarUser | undefined;
  serverHost: string | undefined;
  onSelectRoute: (name: string) => void;
  onPressProfile: () => void;
}

export function Sidebar({
  activeRouteName,
  collapsed,
  routes,
  user,
  serverHost,
  onSelectRoute,
  onPressProfile,
}: Props) {
  const insets = useSafeAreaInsets();

  // Animate label opacity off the prop so width + labels share the same
  // 200ms ease curve. Reanimated derives this on the UI thread without
  // a useEffect (see CLAUDE.md / state.tsx — no useEffects).
  const labelStyle = useAnimatedStyle(() => ({
    opacity: withTiming(collapsed ? 0 : 1, {
      duration: duration.normal,
      easing: Easing.inOut(Easing.ease),
    }),
  }));

  return (
    <View
      style={[styles.root, { width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }]}
    >
      <View style={[styles.serverHeader, { paddingTop: insets.top + 12 }]}>
        <Image source={APP_ICON} style={styles.appIcon} contentFit="cover" />
        {!collapsed ? (
          <Animated.View style={[styles.serverHeaderText, labelStyle]}>
            <Text style={styles.serverName} numberOfLines={1}>
              {serverHost ?? "—"}
            </Text>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.nav}>
        {routes.map((route) => {
          const isActive = route.name === activeRouteName;
          return (
            <Pressable
              key={route.name}
              accessibilityRole="button"
              accessibilityLabel={route.label}
              accessibilityState={{ selected: isActive }}
              onPress={() => onSelectRoute(route.name)}
              style={({ pressed }) => [
                styles.navRow,
                collapsed && styles.navRowCollapsed,
                isActive && styles.navRowActive,
                pressed && styles.navRowPressed,
              ]}
            >
              <NerdIcon
                name={route.icon}
                size={18}
                color={isActive ? colors.accent : colors.textSecondary}
              />
              {!collapsed ? (
                <Animated.Text
                  numberOfLines={1}
                  style={[
                    styles.navLabel,
                    {
                      color: isActive ? colors.textPrimary : colors.textSecondary,
                      fontWeight: isActive ? fontWeight.semibold : fontWeight.medium,
                    },
                    labelStyle,
                  ]}
                >
                  {route.label}
                </Animated.Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View
        style={[
          styles.footer,
          collapsed && styles.footerCollapsed,
          { paddingBottom: 16 + insets.bottom },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={user?.displayName ?? "Profile"}
          onPress={onPressProfile}
          style={({ pressed }) => [
            styles.profileRow,
            collapsed && styles.profileRowCollapsed,
            pressed && styles.navRowPressed,
          ]}
        >
          <View
            style={[
              styles.avatar,
              { backgroundColor: user ? profileColorFor(user.userId) : colors.surface },
            ]}
          >
            <Text style={styles.avatarInitial}>
              {(user?.displayName ?? "?").slice(0, 1).toUpperCase()}
            </Text>
          </View>
          {!collapsed ? (
            <Animated.Text style={[styles.profileName, labelStyle]} numberOfLines={1}>
              {user?.displayName ?? "—"}
            </Animated.Text>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  serverHeader: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  appIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  serverHeaderText: { flex: 1 },
  serverName: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: fontWeight.semibold,
  },
  nav: { flex: 1, paddingHorizontal: 12, paddingTop: 8, gap: 4 },
  navRow: {
    height: 40,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  navRowCollapsed: { paddingHorizontal: 0, justifyContent: "center" },
  navRowActive: { backgroundColor: colors.surface },
  navRowPressed: { opacity: opacity.pressed },
  navLabel: { fontSize: fontSize.body },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  footerCollapsed: { justifyContent: "center", paddingHorizontal: 0 },
  profileRow: {
    flex: 1,
    height: 40,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 4,
  },
  profileRowCollapsed: { flex: 0, paddingHorizontal: 0, justifyContent: "center" },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: colors.accentContrast,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
  },
  profileName: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
});
