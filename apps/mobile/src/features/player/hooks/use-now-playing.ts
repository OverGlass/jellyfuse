// Publishes lock-screen / Control Center now-playing metadata for the
// active mpv session and routes remote-control events back into the
// player controls. Native side auto-syncs elapsed time + rate from the
// existing property observers, so we only push static metadata once
// per session + clear on unmount.

import type { MpvRemoteCommand, NativeMpv } from "@jellyfuse/native-mpv";
import { useEffect, useEffectEvent } from "react";

interface UseNowPlayingArgs {
  mpv: NativeMpv | null;
  title: string | undefined;
  subtitle: string | undefined;
  artworkUri: string | undefined;
  durationSeconds: number | undefined;
  isLiveStream?: boolean;
  isPlaying: boolean;
  position: number;
  duration: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seconds: number) => void;
}

/**
 * Wires the mpv session to `MPNowPlayingInfoCenter` and
 * `MPRemoteCommandCenter`. Metadata is published as soon as both the
 * mpv instance and a non-empty title are available; subsequent metadata
 * changes (e.g. artwork arriving late) re-publish automatically.
 *
 * Remote commands are dispatched back to the player-screen handlers so
 * business logic (skip intro, next episode) stays in one place.
 */
export function useNowPlaying({
  mpv,
  title,
  subtitle,
  artworkUri,
  durationSeconds,
  isLiveStream,
  isPlaying,
  position,
  duration,
  onPlay,
  onPause,
  onSeek,
}: UseNowPlayingArgs): void {
  const handleRemote = useEffectEvent((command: MpvRemoteCommand, value: number) => {
    switch (command) {
      case "play":
        onPlay();
        return;
      case "pause":
        onPause();
        return;
      case "togglePlayPause":
        if (isPlaying) onPause();
        else onPlay();
        return;
      case "skipForward":
        onSeek(Math.min(position + value, duration || position + value));
        return;
      case "skipBackward":
        onSeek(Math.max(position - value, 0));
        return;
      case "changePlaybackPosition":
        onSeek(value);
        return;
      case "nextTrack":
      case "previousTrack":
        // Episode navigation lands in a later phase; no-op for now.
        return;
    }
  });

  // Register the remote-command listener once per mpv instance.
  useEffect(() => {
    if (!mpv) return;
    const sub = mpv.addRemoteCommandListener(handleRemote);
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpv]);

  // Publish metadata whenever the (title, subtitle, artwork) tuple
  // changes. Duration is intentionally NOT a dependency — the native
  // side picks it up from the existing mpv `duration` observer and
  // merges it into the dict on every refresh.
  //
  // IMPORTANT: do NOT clear in this effect's cleanup. When a
  // dependency changes mid-session (e.g. artwork arrives after title),
  // a `null` write would appear in the gap between cleanup and
  // re-publish — and iOS, on seeing nil even briefly, decides we are
  // not a now-playing source and refuses to show the lock-screen UI
  // for the rest of the session. Clearing on true session end is
  // handled by the separate effect below, whose only dep is `mpv`.
  useEffect(() => {
    if (!mpv || !title) return;
    mpv.setNowPlayingMetadata({
      title,
      subtitle,
      artworkUri,
      durationSeconds,
      isLiveStream,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpv, title, subtitle, artworkUri, isLiveStream]);

  // Clear now-playing info only when the mpv session itself goes
  // away (screen unmount, user exits the player).
  useEffect(() => {
    if (!mpv) return;
    return () => {
      mpv.setNowPlayingMetadata(null);
    };
  }, [mpv]);
}
