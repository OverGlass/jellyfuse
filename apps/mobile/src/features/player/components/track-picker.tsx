// Native iOS form-sheet track picker for audio + subtitle selection.
// Uses React Native's `Modal` with `presentationStyle="formSheet"` so
// we get the system card presentation + swipe-down dismissal on iOS.
// Pure component — tracks come from props, selection fires callbacks.
//
// Picker callbacks hand the selected Jellyfin track object up to the
// player screen, which resolves the real mpv `aid` / `sid` via
// `resolveAudioAid` / `resolveSubtitleSid` against mpv's live
// `track-list`. Position-derived ids are unsafe here: sub-add for
// external HTTP sidecars is async, and a naïve `position+1` can land
// on the wrong track mid-session (see project memory
// `mpv_subtitle_sid_mapping`).

import type { AudioStream, SubtitleTrack } from "@jellyfuse/models";
import { colors, fontSize, fontWeight, opacity, radius, spacing } from "@jellyfuse/theme";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

type Tab = "audio" | "subtitles";

interface Props {
  visible: boolean;
  audioStreams: AudioStream[];
  subtitleTracks: SubtitleTrack[];
  /** Jellyfin stream index of the currently-playing audio track. */
  currentAudioIndex: number | undefined;
  /** Jellyfin stream index of the currently-playing subtitle track, or `undefined` when subs are off. */
  currentSubtitleIndex: number | undefined;
  /** Called with the picked Jellyfin audio stream — screen resolves the mpv aid. */
  onSelectAudio: (stream: AudioStream) => void;
  /** Called with the picked Jellyfin subtitle track — screen resolves the mpv sid. */
  onSelectSubtitle: (track: SubtitleTrack) => void;
  onDisableSubtitles: () => void;
  onClose: () => void;
}

export function TrackPicker(props: Props) {
  // Modal mounts in a separate UIViewController, so the root
  // SafeAreaProvider doesn't propagate in — `useSafeAreaInsets()` would
  // return zeros and leave the header/content clipped by the notch or
  // Dynamic Island in landscape. Wrap the modal's children in their own
  // provider so its descendants read the modal's real insets.
  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      presentationStyle="formSheet"
      onRequestClose={props.onClose}
    >
      <SafeAreaProvider>
        <TrackPickerContent {...props} />
      </SafeAreaProvider>
    </Modal>
  );
}

function TrackPickerContent({
  audioStreams,
  subtitleTracks,
  currentAudioIndex,
  currentSubtitleIndex,
  onSelectAudio,
  onSelectSubtitle,
  onDisableSubtitles,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("audio");

  return (
    <View style={styles.container}>
      {/* Header — title + close button */}
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, spacing.md),
            paddingLeft: Math.max(insets.left, spacing.lg),
            paddingRight: Math.max(insets.right, spacing.lg),
          },
        ]}
      >
        <Text style={styles.title}>{t("player.tracks.title")}</Text>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.rowPressed]}
        >
          <Text style={styles.closeLabel}>{t("common.done")}</Text>
        </Pressable>
      </View>

      {/* Tab bar */}
      <View
        style={[
          styles.tabBar,
          {
            paddingLeft: Math.max(insets.left, spacing.lg),
            paddingRight: Math.max(insets.right, spacing.lg),
          },
        ]}
      >
        <Pressable
          onPress={() => setTab("audio")}
          style={[styles.tab, tab === "audio" && styles.tabActive]}
        >
          <Text style={[styles.tabLabel, tab === "audio" && styles.tabLabelActive]}>
            {t("player.tracks.audio")}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("subtitles")}
          style={[styles.tab, tab === "subtitles" && styles.tabActive]}
        >
          <Text style={[styles.tabLabel, tab === "subtitles" && styles.tabLabelActive]}>
            {t("player.tracks.subtitles")}
          </Text>
        </Pressable>
      </View>

      {/* Track list */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={{
          paddingLeft: Math.max(insets.left, spacing.lg),
          paddingRight: Math.max(insets.right, spacing.lg),
          paddingBottom: Math.max(insets.bottom, spacing.lg),
        }}
      >
        {tab === "audio"
          ? audioStreams.map((stream) => (
              <Row
                key={stream.index}
                title={stream.displayTitle}
                meta={stream.codec ? stream.codec.toUpperCase() : undefined}
                selected={stream.index === currentAudioIndex}
                onPress={() => {
                  onSelectAudio(stream);
                  onClose();
                }}
              />
            ))
          : null}

        {tab === "subtitles" ? (
          <>
            <Row
              title={t("player.subtitle.off")}
              selected={currentSubtitleIndex === undefined}
              onPress={() => {
                onDisableSubtitles();
                onClose();
              }}
            />
            {subtitleTracks.map((track) => (
              <Row
                key={track.index}
                title={`${track.displayTitle}${track.isForced ? ` (${t("player.tracks.forced")})` : ""}`}
                meta={track.codec ? track.codec.toUpperCase() : undefined}
                selected={track.index === currentSubtitleIndex}
                onPress={() => {
                  onSelectSubtitle(track);
                  onClose();
                }}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

interface RowProps {
  title: string;
  meta?: string;
  selected: boolean;
  onPress: () => void;
}

function Row({ title, meta, selected, onPress }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.checkSlot}>{selected ? <Text style={styles.check}>✓</Text> : null}</View>
      <Text style={styles.rowTitle}>{title}</Text>
      {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.title,
    fontWeight: fontWeight.bold,
  },
  closeBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  closeLabel: {
    color: colors.accent,
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
  },
  tabBar: {
    flexDirection: "row",
    gap: spacing.md,
    paddingBottom: spacing.md,
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
    flex: 1,
  },
  row: {
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    opacity: opacity.pressed,
  },
  checkSlot: {
    width: spacing.lg,
    alignItems: "center",
    marginRight: spacing.sm,
  },
  check: {
    color: colors.accent,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
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
