/**
 * Downloads management screen. Shows all local downloads grouped
 * by state: In Progress → Paused → Done → Failed / Queued.
 *
 * Reads `useLocalDownloads()` (RQ cache maintained by the Nitro
 * events bridge in `useLocalDownloadsSync`). Actions dispatch to
 * `useDownloader()` which calls the Nitro module methods.
 */
import { colors, fontSize, fontWeight, spacing } from "@jellyfuse/theme";
import type { DownloadRecord } from "@jellyfuse/models";
import { FlashList } from "@shopify/flash-list";
import { router } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NerdIcon } from "@/features/common/components/nerd-icon";
import { ScreenHeader } from "@/features/common/components/screen-header";
import { DownloadRow, type DownloadRowCallbacks } from "../components/download-row";
import { useDownloader } from "@/services/downloads/context";
import { useLocalDownloads } from "@/services/downloads/use-local-downloads";
import { PILL_TAB_CLEARANCE } from "@/features/common/components/pill-tab-bar";

type Section = { type: "header"; label: string } | { type: "row"; record: DownloadRecord };

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
  const downloader = useDownloader();
  const records = useLocalDownloads();
  const insets = useSafeAreaInsets();

  const sections = buildSections(records);

  const callbacks: DownloadRowCallbacks = {
    onPause: (id) => downloader.pause(id),
    onResume: (id) => downloader.resume(id),
    onCancel: (id) => {
      Alert.alert("Cancel Download", "Cancel and discard this download?", [
        { text: "Keep", style: "cancel" },
        { text: "Cancel Download", style: "destructive", onPress: () => downloader.cancel(id) },
      ]);
    },
    onDelete: (id) => {
      Alert.alert("Delete Download", "Remove this downloaded file?", [
        { text: "Keep", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => downloader.remove(id) },
      ]);
    },
    onRetry: (id) => {
      // Re-enqueue: find record, resume will handle it if paused; otherwise
      // the user should tap download again from the detail screen.
      downloader.resume(id);
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
        onPress: () => downloader.clearAll(),
      },
    ]);
  }

  const pillBottom = insets.bottom > 0 ? insets.bottom - 8 : 8;
  const listPaddingBottom = pillBottom + PILL_TAB_CLEARANCE + spacing.lg;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Downloads"
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

      {sections.length === 0 ? (
        <View style={styles.empty}>
          <NerdIcon name="download" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No downloads yet</Text>
          <Text style={styles.emptyBody}>
            Tap the download button on any movie or episode to save it for offline viewing.
          </Text>
        </View>
      ) : (
        <FlashList
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
          contentContainerStyle={{ paddingBottom: listPaddingBottom }}
          showsVerticalScrollIndicator={false}
        />
      )}
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
