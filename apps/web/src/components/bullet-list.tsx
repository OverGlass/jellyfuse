import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@jellyfuse/theme";
import Svg, { Path } from "react-native-svg";

import { HAIRLINE } from "./layout";

type Props = { items: readonly string[] };

// Simple mini-list used inside platform-step blocks. Each row gets a
// faint icon tile + text label. Layout mirrors the prototype's `.minilist`.
export function BulletList({ items }: Props) {
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item} style={styles.row}>
          <View style={styles.iconWrap}>
            <Svg width={12} height={12} viewBox="0 0 16 16" fill="none">
              <Path
                d="M4 8l3 3l5-6"
                stroke={colors.accent}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
          <Text style={styles.text}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
    maxWidth: "44ch" as unknown as number,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: radius.md,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 14 * 1.4,
    paddingVertical: spacing.xs / 2,
  },
});
