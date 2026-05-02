import { Text, View } from "react-native";
import { colors, fontWeight, radius } from "@jellyfuse/theme";

import { webStyles } from "./web-styles";

// Six pre-coloured poster gradients matching the prototype's `.poster.pN`
// classes. Used inside the device-frame mocks so the cross-fade looks
// like real cover art without us having to resolve image rights.
const POSTER_GRADIENTS = [
  { from: "#4a3a5a", to: "#2a2030" }, // p1 — purple
  { from: "#2a4a3a", to: "#1a3025" }, // p2 — green
  { from: "#4a3525", to: "#2f2018" }, // p3 — amber
  { from: "#2a3a55", to: "#1a2435" }, // p4 — blue
  { from: "#553555", to: "#2f1830" }, // p5 — magenta
  { from: "#355555", to: "#183030" }, // p6 — teal
] as const;

type PosterShape = "tall" | "wide" | "tile";

type PosterProps = {
  variant: 1 | 2 | 3 | 4 | 5 | 6;
  shape?: PosterShape;
  width?: number;
  highlighted?: boolean;
};

export function Poster({ variant, shape = "tall", width, highlighted }: PosterProps) {
  const grad = POSTER_GRADIENTS[variant - 1] ?? POSTER_GRADIENTS[0]!;
  const aspect = shape === "tall" ? 2 / 3 : shape === "wide" ? 3 / 4 : 16 / 9;
  return (
    <View
      style={[
        styles.poster,
        { background: `linear-gradient(135deg, ${grad.from}, ${grad.to})` },
        { aspectRatio: aspect },
        width ? { width } : null,
        highlighted ? styles.highlighted : null,
      ]}
    />
  );
}

type ShelfProps = {
  title: string;
  posters: readonly PosterProps[];
};

export function Shelf({ title, posters }: ShelfProps) {
  return (
    <View>
      <Text style={styles.shelfTitle}>{title}</Text>
      <View style={styles.shelfRow}>
        {posters.map((p, idx) => (
          <Poster key={idx} {...p} />
        ))}
      </View>
    </View>
  );
}

type HeroProps = { title: string; subtitle?: string };

// Small mock "hero" card used at the top of the iPhone / Android device
// frames. A two-tone gradient with the title baked into the bottom-left.
export function MockHero({ title, subtitle }: HeroProps) {
  return (
    <View style={styles.mockHero}>
      <View style={styles.mockHeroFade} />
      <View style={styles.mockHeroLabel}>
        <Text style={styles.mockHeroTitle}>{title}</Text>
        {subtitle ? <Text style={styles.mockHeroSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

// Phone status bar mock (9:41 + signal/wifi/battery glyphs).
export function MockStatusBar() {
  return (
    <View style={styles.statusBar}>
      <Text style={styles.statusText}>9:41</Text>
      <View style={styles.statusRight}>
        <View style={styles.signal} />
        <View style={styles.wifi} />
        <View style={styles.batt} />
      </View>
    </View>
  );
}

const styles = webStyles({
  poster: {
    flex: 0,
    width: 72,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.surfaceElevated,
  },
  highlighted: {
    outlineColor: colors.accent,
    outlineStyle: "solid",
    outlineWidth: 2,
    outlineOffset: 3,
    transform: [{ scale: 1.05 }],
  },
  shelfTitle: {
    paddingHorizontal: 12,
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    marginTop: 14,
    marginBottom: 8,
  },
  shelfRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  mockHero: {
    height: "42%",
    background: "linear-gradient(135deg, #355c7d, #2c3e50)",
    position: "relative",
    overflow: "hidden",
  },
  mockHeroFade: {
    position: "absolute",
    inset: 0,
    background: `linear-gradient(180deg, transparent 50%, ${colors.background} 100%)`,
  },
  mockHeroLabel: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 12,
  },
  mockHeroTitle: {
    fontSize: 14,
    fontWeight: fontWeight.bold,
    color: colors.textPrimary,
  },
  mockHeroSubtitle: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statusBar: {
    height: 50,
    paddingHorizontal: 26,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  statusText: {
    fontSize: 13,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
  },
  statusRight: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
  },
  signal: {
    width: 16,
    height: 9,
    backgroundColor: colors.textPrimary,
    clipPath:
      "polygon(0 80%, 22% 80%, 22% 60%, 44% 60%, 44% 38%, 66% 38%, 66% 18%, 88% 18%, 88% 0, 100% 0, 100% 100%, 0 100%)",
  },
  wifi: {
    width: 14,
    height: 10,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderWidth: 2,
    borderColor: colors.textPrimary,
    borderBottomWidth: 0,
  },
  batt: {
    width: 24,
    height: 11,
    borderWidth: 1.5,
    borderColor: colors.textPrimary,
    borderRadius: 3,
    backgroundImage: `linear-gradient(90deg, ${colors.textPrimary} 70%, transparent 70%)`,
  },
});
