import { MpvVideoView, callback, type MpvExternalSubtitle } from "@jellyfuse/native-mpv";
import { ticksToSeconds } from "@jellyfuse/models";
import { colors } from "@jellyfuse/theme";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { resolvePlayback } from "@/services/playback/resolver";
import { useResolverSettings } from "@/services/settings/use-resolver-settings";
import { localTrickplayData, resolveLocalStream } from "@/services/downloads/local-stream";
import { useDownloadForItem } from "@/services/downloads/use-local-downloads";
import { useConnectionStatus } from "@/services/connection/monitor";
import { useMovieDetail } from "@/services/query";
import { ControlsOverlay } from "../components/controls-overlay";
import { SkipSegmentPill } from "../components/skip-segment-pill";
import { TrackPicker } from "../components/track-picker";
import { useMpvPlayer } from "../hooks/use-mpv-player";
import {
  useIntroSkipperSegments,
  usePlaybackInfo,
  useTrickplayInfo,
} from "../hooks/use-playback-info";
import { useReportingSession } from "../hooks/use-reporting-session";
import { useAuth } from "@/services/auth/state";

interface Props {
  jellyfinId: string;
}

export function PlayerScreen({ jellyfinId }: Props) {
  useKeepAwake();

  const { serverUrl } = useAuth();
  const resolverSettings = useResolverSettings();
  const detail = useMovieDetail(jellyfinId);
  // Local-first policy:
  //   - Original download → always use local (source file, full fidelity,
  //     all tracks, zero server bandwidth).
  //   - Transcoded download → only use local when the server is
  //     unreachable. While online, prefer the server stream so the user
  //     can pick any audio/sub track and get fresh quality.
  // Intro-skipper + trickplay + chapters + duration are all captured
  // at enqueue time and carried on the record either way.
  const localRecord = useDownloadForItem(jellyfinId);
  const connection = useConnectionStatus();
  const hasLocal =
    localRecord?.state === "done" && (localRecord.wasOriginal || connection === "offline");
  const playbackInfoQuery = usePlaybackInfo(hasLocal ? undefined : jellyfinId);
  const introSkipperQuery = useIntroSkipperSegments(hasLocal ? undefined : jellyfinId);
  const trickplayQuery = useTrickplayInfo(hasLocal ? undefined : jellyfinId);

  // Pure derivation — resolvePlayback is a pure function, not async
  const resolved =
    hasLocal && localRecord
      ? resolveLocalStream(localRecord)
      : playbackInfoQuery.data
        ? resolvePlayback({
            playbackInfo: playbackInfoQuery.data,
            settings: resolverSettings,
            introSkipperSegments: introSkipperQuery.data ?? undefined,
          })
        : null;

  // Resume position from user data
  const startPosition = detail.data?.userData?.playbackPositionTicks
    ? ticksToSeconds(detail.data.userData.playbackPositionTicks)
    : undefined;

  // External subtitle sidecars for offline transcoded playback. For
  // Originals and online streams this is empty: the server-side tracks
  // already live in the container (Original) or are handled via HLS
  // manifest (transcoded stream). Order must match resolved.subtitleTracks
  // so the UI's position+1 → mpv sid mapping holds.
  const externalSubtitles: MpvExternalSubtitle[] | undefined =
    hasLocal && resolved
      ? resolved.subtitleTracks
          .filter((t): t is typeof t & { deliveryUrl: string } => t.deliveryUrl !== undefined)
          .map((t) => ({
            uri: t.deliveryUrl,
            title: t.displayTitle,
            language: t.language,
          }))
      : undefined;

  // mpv lifecycle — creates instance, subscribes to events, loads stream
  const player = useMpvPlayer(resolved, startPosition, externalSubtitles);

  // Playback reporting — start/progress/stopped to Jellyfin
  useReportingSession({
    mpvRef: player.mpv,
    resolved,
    baseUrl: serverUrl,
  });

  const [trackPickerOpen, setTrackPickerOpen] = useState(false);

  // Buffering during initial load OR mid-playback — the overlay
  // shows the spinner in place of the play button while this is true.
  // Local playback never waits on playback-info, so its `isPending`
  // collapses to just native buffering.
  const isBuffering = (!hasLocal && playbackInfoQuery.isPending) || player.isBuffering;

  if ((!hasLocal && playbackInfoQuery.isError) || player.error) {
    // `mpv.not_implemented` is the sentinel the Android stub throws
    // until Phase C lands libmpv. Show a friendlier copy for that
    // specific code — anything else is a real playback failure.
    const isUnsupported = player.error === "mpv.not_implemented";
    const title = isUnsupported ? "Playback Unavailable" : "Playback Error";
    const body = isUnsupported
      ? "Video playback isn't supported on Android yet. It's on the way."
      : (player.error ??
        (playbackInfoQuery.error instanceof Error
          ? playbackInfoQuery.error.message
          : "Failed to load playback info"));
    return (
      <View style={styles.container}>
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>{title}</Text>
          <Text style={styles.errorBody}>{body}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* MpvVideoView fills edge-to-edge — behind notch/Dynamic Island */}
      {player.mpv ? (
        <MpvVideoView
          style={StyleSheet.absoluteFill}
          hybridRef={callback((ref) => {
            if (ref && player.mpv) {
              try {
                ref.attachPlayer(player.mpv.instanceId);
              } catch (e) {
                console.error("[player] attachPlayer error:", e);
              }
            }
          })}
        />
      ) : null}

      {/* Intro/recap/credits skip pill */}
      <SkipSegmentPill
        position={player.position}
        segments={resolved?.introSkipperSegments}
        onSkip={player.seek}
      />

      {/* Controls overlay — uses safe area insets internally */}
      <ControlsOverlay
        title={detail.data?.title ?? ""}
        subtitle={detail.data?.seriesName}
        isPlaying={player.isPlaying}
        isBuffering={isBuffering}
        position={player.position}
        duration={player.duration}
        chapters={resolved?.chapters}
        trickplay={
          hasLocal && localRecord
            ? localTrickplayData(localRecord)
            : (trickplayQuery.data ?? undefined)
        }
        onPlayPause={player.isPlaying ? player.pause : player.play}
        onSeek={player.seek}
        onSkipForward={player.skipForward}
        onSkipBackward={player.skipBackward}
        onDismiss={() => router.back()}
        onOpenTrackPicker={
          resolved?.audioStreams.length || resolved?.subtitleTracks.length
            ? () => setTrackPickerOpen(true)
            : undefined
        }
      />

      {/* Track picker bottom sheet */}
      <TrackPicker
        visible={trackPickerOpen}
        audioStreams={resolved?.audioStreams ?? []}
        subtitleTracks={resolved?.subtitleTracks ?? []}
        onSelectAudio={player.setAudioTrack}
        onSelectSubtitle={player.setSubtitleTrack}
        onDisableSubtitles={player.disableSubtitles}
        onClose={() => setTrackPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "600",
  },
  errorBody: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
});
