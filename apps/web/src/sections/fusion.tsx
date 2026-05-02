import { Text, View } from "react-native";
import { colors, fontWeight, radius, spacing } from "@jellyfuse/theme";

import { Eyebrow } from "../components/eyebrow";
import { Heading } from "../components/heading";
import { Reveal } from "../components/reveal";
import { Section } from "../components/section";
import { HAIRLINE } from "../components/layout";
import { webStyles } from "../components/web-styles";
import { FUSION, FUSION_MOCK } from "../lib/content";

// "The fusion" — two-column section. Left: copy + numbered list. Right:
// a cropped iPhone mock showing search blending library hits with
// request candidates. The phone mock is decorative (`aria-hidden`) so
// the screen-reader sees only the textual list.
export function Fusion() {
  return (
    <Section bordered="both" padding="lg">
      <View style={styles.grid}>
        <View style={styles.copyCol}>
          <Reveal>
            <Eyebrow>{FUSION.eyebrow}</Eyebrow>
          </Reveal>
          <Reveal delay={1}>
            <Heading level={2} style={styles.headline}>
              {FUSION.headlineLine1}
              {"\n"}
              {FUSION.headlineLine2}
            </Heading>
          </Reveal>
          <Reveal delay={2}>
            <Text style={styles.lead}>{FUSION.lead}</Text>
          </Reveal>
          <Reveal delay={3}>
            <View style={styles.list}>
              {FUSION.steps.map((step, idx) => (
                <View
                  key={step.num}
                  style={[styles.listRow, idx === FUSION.steps.length - 1 ? styles.lastRow : null]}
                >
                  <Text style={styles.num}>{step.num}</Text>
                  <Text style={styles.body}>
                    <Text style={styles.strong}>{step.strong}</Text>
                    {step.tail}
                  </Text>
                </View>
              ))}
            </View>
          </Reveal>
        </View>

        <Reveal delay={2} style={styles.mockCol} aria-hidden>
          <View style={styles.phoneFrame}>
            <View style={styles.phoneScreen}>
              <View style={styles.phoneNotch} />
              <View style={styles.phoneStatus}>
                <Text style={styles.phoneTime}>9:41</Text>
                <View style={styles.phoneIcons}>
                  <View style={styles.signal} />
                  <View style={styles.wifi} />
                  <View style={styles.batt} />
                </View>
              </View>
              <View style={styles.phoneContent}>
                <View style={styles.searchBar}>
                  <View style={styles.mag} />
                  <Text style={styles.searchText}>{FUSION_MOCK.query}</Text>
                </View>

                <View style={styles.sectionLabelRow}>
                  <Text style={styles.sectionLabel}>In your library</Text>
                  <Text style={[styles.badgeMini, styles.badgeLib]}>Library</Text>
                </View>
                {FUSION_MOCK.library.map((item, idx) => (
                  <SearchRow
                    key={item.title}
                    poster={idx + 1}
                    title={item.title}
                    meta={item.meta}
                    action={item.action}
                  />
                ))}

                <View style={styles.sectionLabelRow}>
                  <Text style={styles.sectionLabel}>Available to request</Text>
                  <Text style={[styles.badgeMini, styles.badgeReq]}>Request</Text>
                </View>
                {FUSION_MOCK.request.map((item, idx) => (
                  <SearchRow
                    key={item.title}
                    poster={idx + 3}
                    title={item.title}
                    meta={item.meta}
                    action={item.action}
                    ghost
                  />
                ))}
              </View>
            </View>
          </View>
        </Reveal>
      </View>
    </Section>
  );
}

type SearchRowProps = {
  poster: number;
  title: string;
  meta: string;
  action: string;
  ghost?: boolean;
};

const POSTER_GRADS = [
  "linear-gradient(135deg, #4a3a5a, #2a2030)",
  "linear-gradient(135deg, #2a4a3a, #1a3025)",
  "linear-gradient(135deg, #4a3525, #2f2018)",
  "linear-gradient(135deg, #2a3a55, #1a2435)",
];

function SearchRow({ poster, title, meta, action, ghost }: SearchRowProps) {
  const grad = POSTER_GRADS[poster - 1] ?? POSTER_GRADS[0]!;
  return (
    <View style={styles.searchRow}>
      <View style={[styles.searchPoster, { backgroundImage: grad }]} />
      <View style={styles.searchMeta}>
        <Text style={styles.searchTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.searchSub} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <Text style={[styles.searchAction, ghost ? styles.searchActionGhost : null]}>{action}</Text>
    </View>
  );
}

const styles = webStyles({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "clamp(32px, 6vw, 96px)",
    alignItems: "center",
  },
  copyCol: {
    flex: 1,
    minWidth: 280,
  },
  mockCol: {
    flex: 1,
    minWidth: 280,
    alignItems: "flex-end",
  },
  headline: {
    marginBottom: spacing.lg,
  },
  lead: {
    fontSize: "clamp(18px, 1.5vw, 22px)",
    color: colors.textSecondary,
    lineHeight: "1.45",
    maxWidth: "56ch",
    marginBottom: spacing.xl,
  },
  list: {
    flexDirection: "column",
  },
  listRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  lastRow: {
    borderBottomWidth: 1,
    borderBottomColor: HAIRLINE,
  },
  num: {
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
    fontSize: 14,
    color: colors.accent,
    fontWeight: fontWeight.semibold,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  body: {
    flex: 1,
    fontSize: 16,
    color: colors.textSecondary,
    lineHeight: "1.5",
  },
  strong: {
    color: colors.textPrimary,
    fontWeight: fontWeight.semibold,
  },
  // ─── phone mock ──────────────────────────────────────────────────
  phoneFrame: {
    position: "relative",
    width: "min(420px, 100%)",
    aspectRatio: 9 / 17,
    backgroundColor: "#0d0f12",
    borderRadius: 44,
    padding: 8,
    boxShadow:
      "0 0 0 1.5px #2a2f37, 0 1px 0 0 #3a4049 inset, 0 40px 80px -20px rgba(0,0,0,0.6), 0 80px 160px -40px rgba(97,175,239,0.18)",
  },
  phoneScreen: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 36,
    overflow: "hidden",
    position: "relative",
  },
  phoneNotch: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    width: 110,
    height: 28,
    backgroundColor: "#000",
    borderRadius: 999,
    transform: [{ translateX: -55 }],
    left: "50%",
    zIndex: 4,
  },
  phoneStatus: {
    height: 50,
    paddingHorizontal: 26,
    paddingBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    zIndex: 3,
  },
  phoneTime: {
    fontSize: 13,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    fontFamily: '"SF Pro Display", -apple-system, "Inter", system-ui, sans-serif',
  },
  phoneIcons: {
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
  phoneContent: {
    paddingHorizontal: 16,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  mag: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  searchText: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  sectionLabelRow: {
    marginTop: 18,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.1 * 11,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  badgeMini: {
    fontSize: 9,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.05 * 9,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  badgeLib: {
    color: colors.success,
    backgroundColor: "rgba(152,195,121,0.18)",
  },
  badgeReq: {
    color: colors.accent,
    backgroundColor: "rgba(97,175,239,0.18)",
  },
  searchRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 8,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  searchPoster: {
    width: 44,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceElevated,
  },
  searchMeta: {
    flex: 1,
    minWidth: 0,
  },
  searchTitle: {
    fontSize: 13,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  searchSub: {
    fontSize: 11,
    color: colors.textMuted,
  },
  searchAction: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: colors.accent,
    color: colors.accentContrast,
  },
  searchActionGhost: {
    backgroundColor: "transparent",
    color: colors.textSecondary,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
});
