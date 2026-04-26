// Custom hook managing the mpv player lifecycle. Creates the instance
// on mount, subscribes to events via useEffectEvent (stable callbacks
// that don't cause re-subscriptions), and loads the stream when the
// resolved playback data arrives.
//
// Follows React's mental model:
// - useQuery for async data (usePlaybackInfo)
// - useEffect to sync external system (mpv) with React state
// - useEffectEvent for imperative callbacks that read latest values

import {
  createNativeMpv,
  type MpvExternalSubtitle,
  type MpvListener,
  type NativeMpv,
} from "@jellyfuse/native-mpv";
import type { ResolvedStream } from "@jellyfuse/models";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

// Position is never stored in React state — it lives only on the UI
// thread via `positionShared`. Duration lives in both React state (for
// segment layout) and a shared value (for UI-thread reads), but state
// is only updated when the value actually changes, so the player tree
// re-renders zero times during steady-state playback.

export interface MpvPlayerState {
  mpv: NativeMpv | null;
  isPlaying: boolean;
  isBuffering: boolean;
  duration: number;
  error: string | null;
}

export interface UseMpvPlayerReturn extends MpvPlayerState {
  /** UI-thread position mirror, updated on every mpv tick (~10 Hz). */
  positionShared: SharedValue<number>;
  /** UI-thread duration mirror. */
  durationShared: SharedValue<number>;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  skipForward: () => void;
  skipBackward: () => void;
  setAudioTrack: (trackId: number) => void;
  setSubtitleTrack: (trackId: number) => void;
  disableSubtitles: () => void;
}

/**
 * Manages a single mpv player session. Creates the instance on mount,
 * subscribes to events, loads the resolved stream, and cleans up on
 * unmount. All mpv event callbacks use `useEffectEvent` so they
 * always read latest state without being effect dependencies.
 */
export interface UseMpvPlayerOptions {
  startPositionSeconds?: number;
  externalSubtitles?: MpvExternalSubtitle[];
  /** Fires when mpv reports natural end-of-file (not user-initiated stop). */
  onPlaybackEnded?: () => void;
}

export function useMpvPlayer(
  resolved: ResolvedStream | null,
  options: UseMpvPlayerOptions = {},
): UseMpvPlayerReturn {
  const { startPositionSeconds, externalSubtitles, onPlaybackEnded } = options;
  const mpvRef = useRef<NativeMpv | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const positionShared = useSharedValue(0);
  const durationShared = useSharedValue(0);
  // Plain JS refs mirror the shared values for callers that run on
  // the JS thread (skipForward/Backward, lock-screen remotes). Reading
  // `positionShared.value` right after a JS-thread write has been flaky
  // since the zero-re-render refactor — Reanimated's JS shadow isn't
  // guaranteed to be synchronously updated across all runtime versions.
  // The ref is synchronous, full stop.
  const positionRef = useRef(0);
  const durationRef = useRef(0);

  // ── Event handlers via useEffectEvent ──────────────────────────────
  // These are stable — they always see the latest closure values but
  // never cause the effect to re-run. Perfect for native callbacks.

  const onProgress = useEffectEvent((pos: number, dur: number) => {
    // Shared values update every tick — scrubber fill, thumb, time
    // text, skip-segment pill, and now-playing remotes all read from
    // these on the UI thread with zero React work.
    positionShared.value = pos;
    durationShared.value = dur;
    // JS-thread mirror for skip math — see positionRef declaration.
    positionRef.current = pos;
    // Duration effectively only changes once per load. Guarding the
    // setState means the player tree re-renders zero times during
    // steady-state playback.
    if (dur !== durationRef.current) {
      durationRef.current = dur;
      setDuration(dur);
    }
  });

  const onStateChange = useEffectEvent((state: string) => {
    setIsPlaying(state === "playing");
  });

  const onEnded = useEffectEvent(() => {
    setIsPlaying(false);
    // mpv emits `end-file` not only on natural EOF but also on `loadfile`
    // swaps and explicit `stop` commands. Guard the upstream
    // `onPlaybackEnded` (autoplay-next on series detail) against those
    // false positives by checking the position is actually near the
    // declared duration. 5 s of slack covers credits / decoding tail.
    const pos = positionRef.current;
    const dur = durationRef.current;
    if (dur > 0 && pos >= dur - 5) {
      onPlaybackEnded?.();
    }
  });

  const onError = useEffectEvent((msg: string) => {
    console.error("[player] mpv error:", msg);
    setError(msg);
  });

  const onBuffering = useEffectEvent((buffering: boolean) => {
    setIsBuffering(buffering);
  });

  // ── Sync mpv lifecycle with React ─────────────────────────────────

  useEffect(() => {
    const mpv = createNativeMpv();
    mpvRef.current = mpv;

    const subs: MpvListener[] = [
      mpv.addProgressListener(onProgress),
      mpv.addStateChangeListener(onStateChange),
      mpv.addEndedListener(onEnded),
      mpv.addErrorListener(onError),
      mpv.addBufferingListener(onBuffering),
    ];

    return () => {
      for (const s of subs) s.remove();
      mpv.release();
      mpvRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Mount/unmount only — callbacks are stable via useEffectEvent

  // ── Load stream when URL changes ──────────────────────────────────
  // Depend on the URL string (primitive), not the resolved object —
  // `resolvePlayback()` creates a new object each render which would
  // cause an infinite load loop.

  const streamUrl = resolved?.streamUrl;
  const audioTrackIndex = resolved?.audioMpvTrackId;
  const subtitleTrackIndex = resolved?.subtitleMpvTrackId;
  // Stable-by-content signature so a new array reference per render
  // doesn't retrigger the load effect. Subtitles are identified by URI.
  const externalSubsKey = externalSubtitles?.map((s) => s.uri).join("|") ?? "";

  useEffect(() => {
    if (!streamUrl || !mpvRef.current) return;

    // Use the latest mpv position when re-loading (e.g., audio / subtitle
    // track change mid-playback) so we don't lose the user's place.
    // First load runs with `positionRef.current === 0` and falls through
    // to `startPositionSeconds` (the server-side resume anchor).
    //
    // CRITICAL: `startPositionSeconds` is intentionally NOT in this
    // effect's deps. The detail query refetches its UserData while
    // playback is in progress (cache invalidation, focus refetches),
    // which would shift `startPositionSeconds` and trigger an mpv
    // `loadfile` reload — and mpv emits a spurious `end-file` event on
    // every reload, which our `onEnded` listener would interpret as
    // natural EOF and autoplay the next episode. The original anchor is
    // captured the first time this effect runs; subsequent runs (audio
    // track change, etc.) seek to the latest known position.
    const seekTo = positionRef.current > 0 ? positionRef.current : startPositionSeconds;

    try {
      mpvRef.current.load(streamUrl, {
        startPositionSeconds: seekTo,
        audioTrackIndex,
        subtitleTrackIndex,
        externalSubtitles,
      });
    } catch (e) {
      console.error("[player] load failed:", e);
      onError(e instanceof Error ? e.message : String(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl, audioTrackIndex, subtitleTrackIndex, externalSubsKey]); // onError is stable via useEffectEvent

  // ── Imperative controls ───────────────────────────────────────────

  function play() {
    mpvRef.current?.play();
  }

  function pause() {
    mpvRef.current?.pause();
  }

  function seek(seconds: number) {
    mpvRef.current?.seek(seconds);
    // Optimistic: jump the scrubber + time text immediately so the
    // seek feels instant, even though the next mpv progress tick is
    // up to ~100 ms away.
    positionShared.value = seconds;
    positionRef.current = seconds;
  }

  function skipForward() {
    // Refs beat shared values for JS-thread reads — see comment at
    // the positionRef declaration.
    const pos = positionRef.current;
    const dur = durationRef.current;
    seek(Math.min(pos + 10, dur > 0 ? dur : pos + 10));
  }

  function skipBackward() {
    const pos = positionRef.current;
    seek(Math.max(pos - 10, 0));
  }

  function setAudioTrack(trackId: number) {
    mpvRef.current?.setAudioTrack(trackId);
  }

  function setSubtitleTrack(trackId: number) {
    mpvRef.current?.setSubtitleTrack(trackId);
  }

  function disableSubtitles() {
    mpvRef.current?.disableSubtitles();
  }

  return {
    mpv: mpvRef.current,
    isPlaying,
    isBuffering,
    duration,
    positionShared,
    durationShared,
    error,
    play,
    pause,
    seek,
    skipForward,
    skipBackward,
    setAudioTrack,
    setSubtitleTrack,
    disableSubtitles,
  };
}
