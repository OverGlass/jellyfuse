import { NerdIcon } from "@/features/common/components/nerd-icon";
import { PillTabBar } from "@/features/common/components/pill-tab-bar";
import { Tabs } from "expo-router";
import { useTranslation } from "react-i18next";

/**
 * Bottom tab bar layout for the main app. Uses the custom `PillTabBar`
 * renderer — a floating pill with native blur and dark semi-transparent
 * overlay, mirroring the Rust mobile `tab_bar.rs` design.
 *
 * Lives inside the `(app)` Stack so modal overlays (detail, player,
 * request sheet) push on top of the tabs without the pill showing through.
 *
 * The `index` screen is a redirect stub and is hidden from the pill by
 * `PillTabBar` which skips routes named "index".
 */
export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <PillTabBar {...props} />}>
      {/* Redirect stub — skipped by PillTabBar. */}
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
