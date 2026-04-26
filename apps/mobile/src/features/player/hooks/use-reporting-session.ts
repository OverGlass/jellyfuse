// Wires mpv playback events to the Jellyfin reporting endpoints.
// Reports start on first play, progress every 5s, stopped on unmount.
// Uses useEffectEvent for the reporting callbacks so they always read
// the latest position without being effect dependencies.
//
// On stopped, invalidates every cache slot whose contents depend on
// `UserData.PlaybackPositionTicks` / `UserData.Played` — home shelves
// (Continue Watching, Next Up, Recently Added, Latest TV/Movies),
// the paginated "see all" shelf grid, and the movie / series /
// season-episodes detail families. Without the detail invalidation
// the resume bar on the detail screen stays stuck at the pre-playback
// position until the natural staleTime expires (up to 5 minutes).
// Mirrors the Rust rule in
// `crates/jf-mobile/src/root/playback.rs:285-294`.

import type { NativeMpv } from "@jellyfuse/native-mpv";
import { secondsToTicks, type ResolvedStream } from "@jellyfuse/models";
import { useEffect, useEffectEvent, useRef } from "react";
import { reportStart, reportProgress, reportStopped } from "@/services/playback/reporter";
import { queryClient } from "@/services/query";
import { isAffectedQuery } from "@/services/query/hooks/played-cache-patch";

const PROGRESS_INTERVAL_MS = 5_000;

interface UseReportingSessionArgs {
  mpvRef: NativeMpv | null;
  resolved: ResolvedStream | null;
  baseUrl: string | undefined;
  userId: string | undefined;
}

export function useReportingSession({
  mpvRef,
  resolved,
  baseUrl,
  userId,
}: UseReportingSessionArgs): void {
  const reportedStartRef = useRef(false);
  const positionRef = useRef(0);
  /**
   * `true` once mpv has fired at least one progress event (= playback
   * actually started rendering frames). Until then we have no reliable
   * position; if the user backs out of the player within ~1–2 s of
   * tapping Resume, mpv hasn't ticked yet and `positionRef.current` is
   * still 0. Reporting Stopped with `positionTicks: 0` in that window
   * tells Jellyfin "stopped at position 0" — which **resets** the
   * server-side resume position, making the next "Resume" tap fall
   * through to the next unplayed episode. Guard the Stop report on
   * this flag so a phantom-open of the player can't damage state.
   */
  const sawProgressRef = useRef(false);
  const isPlayingRef = useRef(false);

  // Stable event handlers — always see latest values, never re-trigger effects
  const onMpvProgress = useEffectEvent((pos: number) => {
    positionRef.current = pos;
    sawProgressRef.current = true;
  });

  const onMpvStateChange = useEffectEvent((state: string) => {
    isPlayingRef.current = state === "playing";
  });

  const doReportStart = useEffectEvent(() => {
    if (!resolved || !baseUrl || reportedStartRef.current) return;
    reportedStartRef.current = true;
    reportStart({
      baseUrl,
      itemId: resolved.mediaSourceId,
      mediaSourceId: resolved.mediaSourceId,
      playSessionId: resolved.playSessionId,
      positionTicks: 0,
      playMethod: resolved.playMethod,
    });
  });

  const doReportStopped = useEffectEvent(() => {
    if (!resolved || !baseUrl) return;
    // Skip Stop entirely when mpv never reported a progress tick — the
    // user opened the player and backed out before any frames rendered,
    // so we have no real position to commit. Sending `positionTicks: 0`
    // here would clobber the server's resume position. We still want to
    // run the invalidation below so any cached series detail / shelf
    // refetches with whatever Start-side state the server recorded.
    if (!sawProgressRef.current) {
      if (userId) {
        queryClient.invalidateQueries({ predicate: isAffectedQuery });
      }
      return;
    }
    reportStopped({
      baseUrl,
      itemId: resolved.mediaSourceId,
      mediaSourceId: resolved.mediaSourceId,
      playSessionId: resolved.playSessionId,
      positionTicks: secondsToTicks(positionRef.current),
    });
    if (userId) {
      // Predicate covers home/* shelves, shelf/* "see all" grids, and
      // detail/{movie,series,season-episodes}. The same predicate is
      // used by `useTogglePlayedState` — playback stop has the same
      // ripple shape (changes UserData.PlaybackPositionTicks / Played).
      queryClient.invalidateQueries({ predicate: isAffectedQuery });
    }
  });

  const doReportProgress = useEffectEvent(() => {
    if (!resolved || !baseUrl) return;
    reportProgress({
      baseUrl,
      itemId: resolved.mediaSourceId,
      mediaSourceId: resolved.mediaSourceId,
      playSessionId: resolved.playSessionId,
      positionTicks: secondsToTicks(positionRef.current),
      isPaused: !isPlayingRef.current,
      playMethod: resolved.playMethod,
    });
  });

  useEffect(() => {
    if (!mpvRef || !resolved || !baseUrl) return;

    // Report start
    doReportStart();

    // Subscribe to mpv events for position tracking
    const progressSub = mpvRef.addProgressListener((pos) => onMpvProgress(pos));
    const stateSub = mpvRef.addStateChangeListener((state) => onMpvStateChange(state));
    const endedSub = mpvRef.addEndedListener(() => doReportStopped());

    // Progress reporting interval
    const interval = setInterval(doReportProgress, PROGRESS_INTERVAL_MS);

    return () => {
      progressSub.remove();
      stateSub.remove();
      endedSub.remove();
      clearInterval(interval);
      doReportStopped();
    };
  }, [mpvRef, resolved, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps
}
