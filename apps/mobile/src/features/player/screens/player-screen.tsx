import { MpvVideoView, callback, type MpvExternalSubtitle } from "@jellyfuse/native-mpv";
import { mediaIdJellyfin, ticksToSeconds } from "@jellyfuse/models";
import { colors } from "@jellyfuse/theme";
import { useKeepAwake } from "expo-keep-awake";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { resolvePlayback } from "@/services/playback/resolver";
import {
  currentAudioJellyfinIndex,
  currentSubtitleJellyfinIndex,
  resolveAudioAid,
  resolveSubtitleSid,
} from "@/services/playback/live-track-map";
import { useResolverSettings } from "@/services/settings/use-resolver-settings";
import { localTrickplayData, resolveLocalStream } from "@/services/downloads/local-stream";
import { useDownloadForItem } from "@/services/downloads/use-local-downloads";
import { useNextLocalEpisode } from "@/services/downloads/use-next-local-episode";
import { useConnectionStatus } from "@/services/connection/monitor";
import { useAdjacentEpisode, useMovieDetail } from "@/services/query";
import { ControlsOverlay } from "../components/controls-overlay";
import { EndOfEpisodeOverlay } from "../components/end-of-episode-overlay";
import { SkipSegmentPill } from "../components/skip-segment-pill";
import { TrackPicker } from "../components/track-picker";
import { useMpvPlayer } from "../hooks/use-mpv-player";
import { useNowPlaying } from "../hooks/use-now-playing";
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
  const { t } = useTranslation();

  const { serverUrl, activeUser } = useAuth();
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
      ? resolveLocalStream(localRecord, resolverSettings)
      : playbackInfoQuery.data
        ? resolvePlayback({
            playbackInfo: playbackInfoQuery.data,
            settings: resolverSettings,
            introSkipperSegments: introSkipperQuery.data ?? undefined,
          })
        : null;

  // Resume position from user data — captured ONCE when detail first
  // resolves, then frozen for the rest of the player's lifetime. The
  // cache entry we read from here is the same one `applyStopReportLocally`
  // mutates on every stop report; if we let `startPosition` track it
  // live, every cache write would feed back into `useMpvPlayer`'s load
  // effect (`startPositionSeconds` is a dep) and force `mpv.load(...)`
  // to fire mid-playback — re-emitting state/ended events that re-fire
  // the stop report → re-patch the cache → infinite loop. Lazy-init
  // ref pattern (sanctioned by the React docs) — read during render is
  // safe because it's deterministic and idempotent.
  const startPositionRef = useRef<{ value: number | undefined }>(undefined);
  if (!startPositionRef.current && detail.data) {
    startPositionRef.current = {
      value: detail.data.userData?.playbackPositionTicks
        ? ticksToSeconds(detail.data.userData.playbackPositionTicks)
        : undefined,
    };
  }
  const startPosition = startPositionRef.current?.value;

  // Every subtitle with a `deliveryUrl` is loaded as an external track
  // via mpv's `sub-add`. This applies to ONLINE playback too — mpv sees
  // only the container's embedded tracks after `loadfile`, so external
  // .srt / .vtt sidecars that Jellyfin exposes with a `DeliveryUrl` must
  // be attached explicitly, otherwise `sid=N` for that track points at
  // nothing and mpv silently falls back to the embedded default.
  // Mirrors the Rust reference `PlayerView::new` in jf-ui-kit.
  const externalSubtitles: MpvExternalSubtitle[] | undefined = resolved
    ? resolved.subtitleTracks
        .filter((t): t is typeof t & { deliveryUrl: string } => t.deliveryUrl !== undefined)
        .map((t) => ({
          uri: t.deliveryUrl,
          title: t.displayTitle,
          language: t.language,
        }))
    : undefined;

  // Pre-fetch the next episode (if any) so autoplay on EOF is a free
  // navigation — the cache is already warm. Episodes only; the query
  // self-disables for movies / non-episode items via `enabled`.
  // Mirrors `JellyfinClient::get_adjacent_episode` in the Rust reference.
  const isEpisode = detail.data?.mediaType === "episode";
  const nextEpisodeQuery = useAdjacentEpisode(
    isEpisode ? detail.data?.seriesId : undefined,
    isEpisode ? jellyfinId : undefined,
  );
  // Offline fallback: walk the downloads list for the next completed
  // episode in the same series. Used as the source of truth when
  // offline — the network query is unreachable and we can only play
  // episodes that are on disk anyway. Online stays network-only:
  // server is authoritative when reachable.
  const localNextEpisode = useNextLocalEpisode(jellyfinId);
  const nextEpisode =
    connection === "offline" ? localNextEpisode : (nextEpisodeQuery.data ?? undefined);

  // On natural end-of-file, navigate to the next episode's player. Use
  // `router.replace` so back still returns to the detail page, not the
  // previous episode. Non-episode items (movies) just fall through — the
  // screen stays on the ended state until the user dismisses it.
  const handlePlaybackEnded = () => {
    const nextId = nextEpisode ? mediaIdJellyfin(nextEpisode.id) : undefined;
    if (nextId) {
      router.replace({
        pathname: "/player/[jellyfinId]",
        params: { jellyfinId: nextId },
      });
    }
  };

  // mpv lifecycle — creates instance, subscribes to events, loads stream
  const player = useMpvPlayer(resolved, {
    startPositionSeconds: startPosition,
    externalSubtitles,
    onPlaybackEnded: handlePlaybackEnded,
  });

  // Playback reporting — start/progress/stopped to Jellyfin
  useReportingSession({
    mpvRef: player.mpv,
    resolved,
    baseUrl: serverUrl,
    jellyfinId,
    userId: activeUser?.userId,
  });

  // Lock-screen / Control Center metadata + remote-control wiring.
  // Episode subtitle format mirrors the Rust UI: "Series · S01E02".
  const subtitle = detail.data?.seriesName
    ? detail.data.seasonNumber && detail.data.episodeNumber
      ? `${detail.data.seriesName} · S${String(detail.data.seasonNumber).padStart(2, "0")}E${String(detail.data.episodeNumber).padStart(2, "0")}`
      : detail.data.seriesName
    : undefined;
  useNowPlaying({
    mpv: player.mpv,
    title: detail.data?.title,
    subtitle,
    artworkUri: detail.data?.posterUrl,
    durationSeconds: player.duration > 0 ? player.duration : undefined,
    isPlaying: player.isPlaying,
    positionShared: player.positionShared,
    durationShared: player.durationShared,
    onPlay: player.play,
    onPause: player.pause,
    onSeek: player.seek,
  });

  const [trackPickerOpen, setTrackPickerOpen] = useState(false);
  // Currently-selected aid/sid read from mpv at picker-open time so the
  // form sheet can render a checkmark next to the active track. Resolved
  // back to Jellyfin stream indices via mpv's live track-list (inverse of
  // `resolveAudioAid` / `resolveSubtitleSid`) — see project memory
  // `mpv_subtitle_sid_mapping`.
  const [currentTracks, setCurrentTracks] = useState<{
    audio: number | undefined;
    subtitle: number | undefined;
  }>({ audio: undefined, subtitle: undefined });
  const openTrackPicker = () => {
    setCurrentTracks({
      audio: currentAudioJellyfinIndex(player.mpv, resolved?.audioStreams ?? []),
      subtitle: currentSubtitleJellyfinIndex(player.mpv, resolved?.subtitleTracks ?? []),
    });
    setTrackPickerOpen(true);
  };

  // Buffering during initial load OR mid-playback — the overlay
  // shows the spinner in place of the play button while this is true.
  // Local playback never waits on playback-info, so its `isPending`
  // collapses to just native buffering.
  const isBuffering = (!hasLocal && playbackInfoQuery.isPending) || player.isBuffering;

  if (!hasLocal && playbackInfoQuery.isError) {
    return (
      <View style={styles.container}>
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>{t("player.error.title")}</Text>
          <Text style={styles.errorBody}>
            {playbackInfoQuery.error instanceof Error
              ? playbackInfoQuery.error.message
              : t("player.error.failedToLoad")}
          </Text>
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

      {/* Controls overlay — uses safe area insets internally */}
      <ControlsOverlay
        title={detail.data?.title ?? ""}
        subtitle={detail.data?.seriesName}
        isPlaying={player.isPlaying}
        isBuffering={isBuffering}
        duration={player.duration}
        positionShared={player.positionShared}
        durationShared={player.durationShared}
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
            ? openTrackPicker
            : undefined
        }
      />

      {/* Intro/recap/credits skip pill — rendered AFTER the controls
          overlay so its Pressable sits above the overlay's full-screen
          backgroundGesture detector; otherwise double-tap seek would
          eat every tap on the pill. */}
      <SkipSegmentPill
        positionShared={player.positionShared}
        durationShared={player.durationShared}
        segments={resolved?.introSkipperSegments}
        hasNext={nextEpisode !== undefined}
        onSkip={player.seek}
      />

      {/* End-of-episode overlays — Watch Credits + Up Next countdown
          (credits-path) and the near-end fallback Up Next card. Ports
          both paths from `PlayerView::render` in the Rust reference;
          a single store enforces the at-most-one-visible invariant. */}
      <EndOfEpisodeOverlay
        positionShared={player.positionShared}
        durationShared={player.durationShared}
        creditsSegment={resolved?.introSkipperSegments?.credits}
        nextEpisode={nextEpisode}
        isPlaying={player.isPlaying}
        onAutoplay={handlePlaybackEnded}
      />

      {/* Track picker bottom sheet — picker hands the Jellyfin track up,
          the screen queries mpv's live track-list to resolve the real
          aid/sid. Ports the `resolve_track_map` pattern from
          `crates/jf-ui-kit/src/views/player/mod.rs`. */}
      <TrackPicker
        visible={trackPickerOpen}
        audioStreams={resolved?.audioStreams ?? []}
        subtitleTracks={resolved?.subtitleTracks ?? []}
        currentAudioIndex={currentTracks.audio}
        currentSubtitleIndex={currentTracks.subtitle}
        onSelectAudio={(stream) => {
          const aid = resolveAudioAid(player.mpv, resolved?.audioStreams ?? [], stream);
          player.setAudioTrack(aid);
        }}
        onSelectSubtitle={(track) => {
          const sid = resolveSubtitleSid(player.mpv, resolved?.subtitleTracks ?? [], track);
          player.setSubtitleTrack(sid);
        }}
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
