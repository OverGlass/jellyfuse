/**
 * Downloads management screen. Shows all local downloads grouped
 * by state: In Progress → Paused → Done → Failed / Queued.
 *
 * Reads `useLocalDownloads()` (RQ cache fed by the Nitro events bridge
 * in `useLocalDownloadsSync`). Actions go through `useDownloaderActions()`
 * which wraps the raw Nitro methods with optimistic RQ-cache updates —
 * necessary because `cancel`/`remove`/`clearAll` don't emit a native
 * state-change event.
 *
 * Layout mirrors the requests / shelf screens: the `ScreenHeader` floats
 * over the list via `FloatingBlurHeader`, and the list's `paddingTop` is
 * tied to the measured header height so the first row doesn't start
 * hidden behind the blur backdrop.
 */
import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import type { DownloadRecord } from "@jellyfuse/models";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedScrollHandler } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { NerdIcon } from "@/features/common/components/nerd-icon";
import { ScreenHeader } from "@/features/common/components/screen-header";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { useFloatingHeaderScroll } from "@/features/common/hooks/use-floating-header-scroll";
import { useRestoredScroll } from "@/features/common/hooks/use-restored-scroll";
import { DownloadRow, type DownloadRowCallbacks } from "../components/download-row";
import { useDownloaderActions, useLocalDownloads } from "@/services/downloads/use-local-downloads";
import { PILL_TAB_CLEARANCE } from "@/features/common/components/pill-tab-bar";

type Section = { type: "header"; label: string } | { type: "row"; record: DownloadRecord };

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<Section>);

function buildSections(records: DownloadRecord[], t: TFunction): Section[] {
  const groups: { label: string; states: DownloadRecord["state"][] }[] = [
    { label: t("downloads.section.inProgress"), states: ["downloading"] },
    { label: t("downloads.section.paused"), states: ["paused", "queued"] },
    { label: t("downloads.section.completed"), states: ["done"] },
    { label: t("downloads.section.failed"), states: ["failed"] },
  ];

  const sections: Section[] = [];
  for (const { label, states } of groups) {
    const items = records
      .filter((r) => states.includes(r.state))
      .sort((a, b) => b.addedAtMs - a.addedAtMs);
    if (items.length === 0) continue;
    sections.push({ type: "header", label });
    for (const record of items) {
      sections.push({ type: "row", record });
    }
  }
  return sections;
}

export function DownloadsScreen() {
  const { t } = useTranslation();
  const actions = useDownloaderActions();
  const records = useLocalDownloads();
  const insets = useSafeAreaInsets();

  const sections = buildSections(records, t);
  const { headerHeight, onHeaderHeightChange, scrollY, backdropStyle } = useFloatingHeaderScroll();
  const scrollRestore = useRestoredScroll("/downloads");
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      "worklet";
      scrollY.value = event.contentOffset.y;
      scheduleOnRN(scrollRestore.setOffset, event.contentOffset.y);
    },
  });

  const callbacks: DownloadRowCallbacks = {
    onPause: (id) => actions.pause(id),
    onResume: (id) => actions.resume(id),
    onCancel: (id) => {
      Alert.alert(t("downloads.cancel.confirmTitle"), t("downloads.cancel.confirmBody"), [
        { text: t("downloads.cancel.confirmKeep"), style: "cancel" },
        {
          text: t("downloads.cancel.confirm"),
          style: "destructive",
          onPress: () => actions.cancel(id),
        },
      ]);
    },
    onDelete: (id) => {
      Alert.alert(t("downloads.delete.confirmTitle"), t("downloads.delete.confirmBody"), [
        { text: t("downloads.delete.confirmKeep"), style: "cancel" },
        {
          text: t("downloads.delete.confirm"),
          style: "destructive",
          onPress: () => actions.remove(id),
        },
      ]);
    },
    onRetry: (id) => {
      // Retry currently means "clear the failed record so the user can
      // re-download from the detail screen". A true in-place retry needs
      // the download URL + headers, which aren't exposed through the
      // Nitro spec yet — tracked for a future iteration.
      actions.remove(id);
    },
    onPlay: (record) => {
      router.push(`/player/${record.itemId}`);
    },
  };

  function handleClearAll() {
    Alert.alert(t("downloads.clearAll.confirmTitle"), t("downloads.clearAll.confirmBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("downloads.clearAll.confirm"),
        style: "destructive",
        onPress: () => actions.clearAll(),
      },
    ]);
  }

  const pillBottom = insets.bottom > 0 ? insets.bottom - 8 : 8;
  const listPaddingBottom = pillBottom + PILL_TAB_CLEARANCE + spacing.lg;

  const isEmpty = sections.length === 0;

  return (
    <View style={styles.container}>
      {isEmpty ? (
        <View style={[styles.empty, { paddingTop: headerHeight + spacing.xxl }]}>
          <NerdIcon name="download" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{t("downloads.empty.title")}</Text>
          <Text style={styles.emptyBody}>{t("downloads.empty.body")}</Text>
        </View>
      ) : (
        <AnimatedFlashList
          ref={scrollRestore.ref}
          onContentSizeChange={scrollRestore.onContentSizeChange}
          data={sections}
          keyExtractor={(item) =>
            item.type === "header" ? `header-${item.label}` : `row-${item.record.id}`
          }
          renderItem={({ item }) => {
            if (item.type === "header") {
              return <Text style={styles.sectionHeader}>{item.label}</Text>;
            }
            return <DownloadRow record={item.record} {...callbacks} />;
          }}
          contentContainerStyle={{
            paddingTop: headerHeight + spacing.sm,
            paddingBottom: listPaddingBottom,
          }}
          showsVerticalScrollIndicator={false}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
        />
      )}

      <ScreenHeader
        title={t("tabs.downloads")}
        backdropStyle={backdropStyle}
        onTotalHeightChange={onHeaderHeightChange}
        rightSlot={
          records.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("downloads.clearAll.ariaLabel")}
              onPress={handleClearAll}
              style={styles.clearBtn}
            >
              <NerdIcon name="trash" size={20} color={colors.textMuted} />
            </Pressable>
          ) : undefined
        }
      />
      <StatusBarScrim />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background,
    flex: 1,
  },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    textTransform: "uppercase",
  },
  empty: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: fontWeight.semibold,
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    lineHeight: 22,
    textAlign: "center",
  },
  clearBtn: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
});
