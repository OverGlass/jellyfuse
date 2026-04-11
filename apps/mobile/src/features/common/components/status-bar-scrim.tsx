import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet } from "react-native";

/**
 * Fixed-position vertical gradient that darkens the area under the
 * status bar / Dynamic Island so the status icons + floating
 * `BackButton` stay readable over bright backdrops. Lives at the
 * root of a screen (outside the `ScrollView`) so it doesn't scroll
 * with the hero — otherwise the iOS bounce would drag it down with
 * the stretched backdrop and the mask would miss the status bar.
 *
 * 120 dp covers iPhone 14/15 Pro Dynamic Island + safe-area.
 * Pure component, no props.
 */
export function StatusBarScrim() {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={["rgba(30,34,39,0.75)", "rgba(30,34,39,0)"]}
      locations={[0, 1]}
      style={styles.root}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    height: 120,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 5,
  },
});
