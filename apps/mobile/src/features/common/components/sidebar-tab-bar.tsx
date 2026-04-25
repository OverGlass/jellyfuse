import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useAuth } from "@/services/auth/state";
import {
  Sidebar,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
  type SidebarRoute,
} from "./sidebar";
import { useBreakpoint } from "@/services/responsive";
import { type IconName } from "@jellyfuse/theme";

const ROUTE_ICONS: Record<string, IconName> = {
  home: "home",
  downloads: "download",
  settings: "settings",
};

/**
 * Tablet/desktop replacement for `PillTabBar`. Renders the persistent
 * `Sidebar` rail flush to the left edge of the screen. The Tabs
 * navigator's scene style adds `paddingLeft` matching the rail width
 * so screen content never sits underneath.
 *
 * Collapse rule: `tablet` breakpoint (600 ≤ width < 1024 — portrait
 * iPad / iPad in Slide-Over) → 72w icon-only. `desktop` (>= 1024 —
 * landscape iPad Pro 11" / Catalyst window) → 264w expanded.
 */
export function SidebarTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { breakpoint } = useBreakpoint();
  const { activeUser, serverUrl } = useAuth();

  const collapsed = breakpoint === "tablet";
  const width = collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  const routes: SidebarRoute[] = state.routes
    .filter((route) => route.name !== "index" && ROUTE_ICONS[route.name] !== undefined)
    .map((route) => {
      const { options } = descriptors[route.key];
      return {
        name: route.name,
        label: options.title ?? route.name,
        icon: ROUTE_ICONS[route.name] ?? "home",
      };
    });

  const activeRouteName = state.routes[state.index]?.name ?? "home";

  function handleSelect(name: string) {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const event = navigation.emit({
      type: "tabPress",
      target: route.key,
      canPreventDefault: true,
    });
    if (state.routes[state.index]?.key === route.key) return;
    if (!event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  }

  function handlePressProfile() {
    router.push("/profile-picker");
  }

  return (
    <View style={[styles.wrapper, { width }]} pointerEvents="box-none">
      <Sidebar
        activeRouteName={activeRouteName}
        collapsed={collapsed}
        routes={routes}
        user={
          activeUser
            ? { userId: activeUser.userId, displayName: activeUser.displayName }
            : undefined
        }
        serverHost={serverUrl ? hostFromUrl(serverUrl) : undefined}
        onSelectRoute={handleSelect}
        onPressProfile={handlePressProfile}
      />
    </View>
  );
}

function hostFromUrl(url: string): string {
  // The auth state stores the server URL with scheme — sidebar shows
  // just the hostname for visual parity with the design ("home.local"
  // rather than "https://home.local:8096").
  return url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 50,
  },
});
