import { NerdIcon } from "@/features/common/components/nerd-icon";
import { PillTabBar } from "@/features/common/components/pill-tab-bar";
import {
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
} from "@/features/common/components/sidebar";
import { SidebarTabBar } from "@/features/common/components/sidebar-tab-bar";
import { useBreakpoint } from "@/services/responsive";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";

/**
 * Bottom tab bar layout for the main app.
 *
 * Phone breakpoint → custom `PillTabBar` (floating pill, native blur),
 * mirroring the Rust mobile `tab_bar.rs` design.
 *
 * Tablet/desktop breakpoint → persistent `SidebarTabBar` rail on the
 * left edge. The scene's `paddingLeft` matches the rail width so screen
 * content never sits underneath. Both layouts share the same `<Tabs>`
 * navigator and route stack — switching between them on iPad
 * multitasking (Split View / Slide Over) is a tabBar swap, not a stack
 * remount, so scroll positions / open detail screens persist.
 *
 * Lives inside the `(app)` Stack so modal overlays (detail, player,
 * request sheet) push on top of the tabs without the bar showing
 * through. The `index` screen is a redirect stub and is hidden by both
 * tabBar implementations.
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { breakpoint } = useBreakpoint();
  const isPhone = breakpoint === "phone";
  const sidebarWidth = isPhone
    ? 0
    : breakpoint === "tablet"
      ? SIDEBAR_WIDTH_COLLAPSED
      : SIDEBAR_WIDTH_EXPANDED;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { paddingLeft: sidebarWidth },
      }}
      tabBar={(props) => (isPhone ? <PillTabBar {...props} /> : <SidebarTabBar {...props} />)}
    >
      {/* Redirect stub — skipped by both tabBar implementations. */}
      <Tabs.Screen name="index" options={{ href: null }} />

      <Tabs.Screen
        name="home"
        options={{
          title: t("tabs.home"),
          tabBarIcon: ({ color, size }) => <NerdIcon name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="downloads"
        options={{
          title: t("tabs.downloads"),
          tabBarIcon: ({ color, size }) => <NerdIcon name="download" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings"),
          tabBarIcon: ({ color, size }) => <NerdIcon name="settings" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
