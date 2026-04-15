import { ScreenHeader } from "@/features/common/components/screen-header";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { useFloatingHeaderScroll } from "@/features/common/hooks/use-floating-header-scroll";
import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Settings tab — stub for Phase 6.
 * Will contain server URL management, audio language, subtitle mode,
 * max streaming bitrate, Jellyseerr status, sign-out, and profile switch.
 */
export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { headerHeight, onHeaderHeightChange } = useFloatingHeaderScroll();

  return (
    <View style={styles.root}>
      <View style={[styles.body, { paddingTop: headerHeight + spacing.xl }]}>
        <Text style={styles.empty}>Settings coming in Phase 6.</Text>
      </View>
      <ScreenHeader title="Settings" onTotalHeightChange={onHeaderHeightChange} />
      <StatusBarScrim />
      {/* Reserve bottom safe-area so content doesn't hide under the home indicator. */}
      <View style={{ height: insets.bottom }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  body: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  empty: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontWeight: fontWeight.regular,
  },
});
