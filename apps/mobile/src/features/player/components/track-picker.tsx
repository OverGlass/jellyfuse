// Bottom-sheet track picker for audio + subtitle selection.
// Pure component — tracks come from props, selection fires callbacks.
//
// Picker callbacks hand the selected Jellyfin track object up to the
// player screen, which resolves the real mpv `aid` / `sid` via
// `resolveAudioAid` / `resolveSubtitleSid` against mpv's live
// `track-list`. Position-derived ids are unsafe here: sub-add for
// external HTTP sidecars is async, and a naïve `position+1` can land
// on the wrong track mid-session (see project memory
// `mpv_subtitle_sid_mapping`).
//
// Not a Modal — React Native Modal has orientation quirks under
// landscape lock. Inline full-screen overlay instead.

import type { AudioStream, SubtitleTrack } from "@jellyfuse/models";
import {
  colors,
  fontSize,
  fontWeight,
  opacity,
  radius,
  spacing,
  withAlpha,
} from "@jellyfuse/theme";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Tab = "audio" | "subtitles";

interface Props {
  visible: boolean;
  audioStreams: AudioStream[];
  subtitleTracks: SubtitleTrack[];
  /** Called with the picked Jellyfin audio stream — screen resolves the mpv aid. */
  onSelectAudio: (stream: AudioStream) => void;
  /** Called with the picked Jellyfin subtitle track — screen resolves the mpv sid. */
  onSelectSubtitle: (track: SubtitleTrack) => void;
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

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Backdrop — tap to dismiss */}
      <Pressable style={styles.backdrop} onPress={onClose} />

      {/* Bottom sheet — inset horizontally to clear notch / Dynamic Island */}
      <View
        style={[
          styles.sheet,
          {
            paddingBottom: Math.max(insets.bottom, spacing.lg),
            paddingLeft: Math.max(insets.left, 0),
            paddingRight: Math.max(insets.right, 0),
          },
        ]}
      >
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
                    onSelectAudio(stream);
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
                    onSelectSubtitle(track);
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
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha(colors.black, opacity.alpha50),
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
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
