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
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NerdIcon } from "@/features/common/components/nerd-icon";
import { ScreenHeader } from "@/features/common/components/screen-header";
import { StatusBarScrim } from "@/features/common/components/status-bar-scrim";
import { useFloatingHeaderScroll } from "@/features/common/hooks/use-floating-header-scroll";
import { DownloadRow, type DownloadRowCallbacks } from "../components/download-row";
import { useDownloaderActions, useLocalDownloads } from "@/services/downloads/use-local-downloads";
import { PILL_TAB_CLEARANCE } from "@/features/common/components/pill-tab-bar";

type Section = { type: "header"; label: string } | { type: "row"; record: DownloadRecord };

const AnimatedFlashList = Animated.createAnimatedComponent(FlashList<Section>);

function buildSections(records: DownloadRecord[]): Section[] {
  const groups: { label: string; states: DownloadRecord["state"][] }[] = [
    { label: "In Progress", states: ["downloading"] },
    { label: "Paused", states: ["paused", "queued"] },
    { label: "Completed", states: ["done"] },
    { label: "Failed", states: ["failed"] },
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
  const actions = useDownloaderActions();
  const records = useLocalDownloads();
  const insets = useSafeAreaInsets();

  const sections = buildSections(records);
  const { headerHeight, onHeaderHeightChange, scrollHandler, backdropStyle } =
    useFloatingHeaderScroll();

  const callbacks: DownloadRowCallbacks = {
    onPause: (id) => actions.pause(id),
    onResume: (id) => actions.resume(id),
    onCancel: (id) => {
      Alert.alert("Cancel Download", "Cancel and discard this download?", [
        { text: "Keep", style: "cancel" },
        { text: "Cancel Download", style: "destructive", onPress: () => actions.cancel(id) },
      ]);
    },
    onDelete: (id) => {
      Alert.alert("Delete Download", "Remove this downloaded file?", [
        { text: "Keep", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => actions.remove(id) },
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
    Alert.alert("Clear All Downloads", "Delete all downloaded files? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete All",
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
          <Text style={styles.emptyTitle}>No downloads yet</Text>
          <Text style={styles.emptyBody}>
            Tap the download button on any movie or episode to save it for offline viewing.
          </Text>
        </View>
      ) : (
        <AnimatedFlashList
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
        title="Downloads"
        backdropStyle={backdropStyle}
        onTotalHeightChange={onHeaderHeightChange}
        rightSlot={
          records.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear all downloads"
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
