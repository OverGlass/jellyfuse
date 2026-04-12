// Bottom-sheet track picker for audio + subtitle selection.
// Pure component — tracks come from props, selection fires callbacks.

import type { AudioStream, SubtitleTrack } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Tab = "audio" | "subtitles";

interface Props {
  visible: boolean;
  audioStreams: AudioStream[];
  subtitleTracks: SubtitleTrack[];
  onSelectAudio: (trackId: number) => void;
  onSelectSubtitle: (trackId: number) => void;
  onDisableSubtitles: () => void;
  onClose: () => void;
}

export function TrackPicker({
  visible,
  audioStreams,
  subtitleTracks,
  onSelectAudio,
  onSelectSubtitle,
  onDisableSubtitles,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("audio");

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View />
      </Pressable>
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        {/* Tab bar */}
        <View style={styles.tabBar}>
          <Pressable
            onPress={() => setTab("audio")}
            style={[styles.tab, tab === "audio" && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, tab === "audio" && styles.tabLabelActive]}>Audio</Text>
          </Pressable>
          <Pressable
            onPress={() => setTab("subtitles")}
            style={[styles.tab, tab === "subtitles" && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, tab === "subtitles" && styles.tabLabelActive]}>
              Subtitles
            </Text>
          </Pressable>
        </View>

        {/* Track list */}
        <ScrollView style={styles.list} bounces={false}>
          {tab === "audio"
            ? audioStreams.map((stream) => (
                <Pressable
                  key={stream.index}
                  onPress={() => {
                    onSelectAudio(stream.index);
                    onClose();
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <Text style={styles.rowTitle}>{stream.displayTitle}</Text>
                  {stream.codec ? (
                    <Text style={styles.rowMeta}>{stream.codec.toUpperCase()}</Text>
                  ) : null}
                </Pressable>
              ))
            : null}

          {tab === "subtitles" ? (
            <>
              <Pressable
                onPress={() => {
                  onDisableSubtitles();
                  onClose();
                }}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Text style={styles.rowTitle}>Off</Text>
              </Pressable>
              {subtitleTracks.map((track) => (
                <Pressable
                  key={track.index}
                  onPress={() => {
                    onSelectSubtitle(track.index);
                    onClose();
                  }}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <Text style={styles.rowTitle}>
                    {track.displayTitle}
                    {track.isForced ? " (Forced)" : ""}
                  </Text>
                  {track.codec ? (
                    <Text style={styles.rowMeta}>{track.codec.toUpperCase()}</Text>
                  ) : null}
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.md,
    maxHeight: "60%",
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  tabActive: {
    backgroundColor: colors.accent,
  },
  tabLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  tabLabelActive: {
    color: colors.textPrimary,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
  row: {
    paddingVertical: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    flex: 1,
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    marginLeft: spacing.sm,
  },
});
