import { colors, fontSize, fontWeight, radius, spacing } from "@jellyfuse/theme";
import { StyleSheet, Text, View } from "react-native";
import type { ConnectionStatus } from "@/services/connection/monitor";

/**
 * Slim banner rendered at the top of a screen when the Jellyfin server
 * is unreachable. Pure component — takes the status as a prop, no
 * state, no reach-into. Hidden in the `"online"` state so parents can
 * always render it unconditionally and let the banner decide whether
 * to show itself.
 *
 * Maps status → background color from the semantic theme tokens so
 * colour hints are consistent with the rest of the app (warning for
 * reconnecting, danger for offline).
 */
interface Props {
  status: ConnectionStatus;
}

export function ConnectionBanner({ status }: Props) {
  if (status === "online") return null;

  const label = status === "connecting" ? "Connecting to server…" : "Offline — showing cached data";
  const style = [styles.root, status === "offline" ? styles.offline : styles.connecting];

  return (
    <View accessibilityRole="alert" style={style}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    borderRadius: radius.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  connecting: {
    backgroundColor: colors.warning,
  },
  offline: {
    backgroundColor: colors.danger,
  },
  label: {
    color: colors.accentContrast,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
  },
});
