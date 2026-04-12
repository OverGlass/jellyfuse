// Custom hook managing the mpv player lifecycle. Creates the instance
// on mount, subscribes to events via useEffectEvent (stable callbacks
// that don't cause re-subscriptions), and loads the stream when the
// resolved playback data arrives.
//
// Follows React's mental model:
// - useQuery for async data (usePlaybackInfo)
// - useEffect to sync external system (mpv) with React state
// - useEffectEvent for imperative callbacks that read latest values

import { createNativeMpv, type NativeMpv, type MpvListener } from "@jellyfuse/native-mpv";
import type { ResolvedStream } from "@jellyfuse/models";
import { useEffect, useEffectEvent, useRef, useState } from "react";

export interface MpvPlayerState {
  mpv: NativeMpv | null;
  isPlaying: boolean;
  isBuffering: boolean;
  position: number;
  duration: number;
  error: string | null;
}

export interface UseMpvPlayerReturn extends MpvPlayerState {
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
export function useMpvPlayer(
  resolved: ResolvedStream | null,
  startPositionSeconds?: number,
): UseMpvPlayerReturn {
  const mpvRef = useRef<NativeMpv | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ── Event handlers via useEffectEvent ──────────────────────────────
  // These are stable — they always see the latest closure values but
  // never cause the effect to re-run. Perfect for native callbacks.

  const onProgress = useEffectEvent((pos: number, dur: number) => {
    setPosition(pos);
    setDuration(dur);
  });

  const onStateChange = useEffectEvent((state: string) => {
    setIsPlaying(state === "playing");
  });

  const onEnded = useEffectEvent(() => {
    setIsPlaying(false);
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
  }, []); // Mount/unmount only — callbacks are stable via useEffectEvent

  // ── Load stream when resolved data arrives ────────────────────────

  useEffect(() => {
    if (!resolved || !mpvRef.current) return;

    console.log("[player] loading stream:", resolved.streamUrl);

    // TODO: map Jellyfin stream indices to mpv track IDs (aid/sid).
    // Jellyfin indices count all stream types; mpv counts per-type.
    // For now, let mpv auto-select default tracks.
    try {
      mpvRef.current.load(resolved.streamUrl, {
        startPositionSeconds,
      });
    } catch (e) {
      console.error("[player] load failed:", e);
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [resolved, startPositionSeconds]);

  // ── Imperative controls ───────────────────────────────────────────

  function play() {
    mpvRef.current?.play();
  }

  function pause() {
    mpvRef.current?.pause();
  }

  function seek(seconds: number) {
    mpvRef.current?.seek(seconds);
  }

  function skipForward() {
    mpvRef.current?.seek(Math.min(position + 10, duration));
  }

  function skipBackward() {
    mpvRef.current?.seek(Math.max(position - 10, 0));
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
    position,
    duration,
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
