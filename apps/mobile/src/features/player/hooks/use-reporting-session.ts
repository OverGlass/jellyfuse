// Wires mpv playback events to the Jellyfin reporting endpoints.
// Reports start on first play, progress every 5s, stopped on unmount.
// Uses useEffectEvent for the reporting callbacks so they always read
// the latest position without being effect dependencies.

import type { NativeMpv } from "@jellyfuse/native-mpv";
import { secondsToTicks, type ResolvedStream } from "@jellyfuse/models";
import { useEffect, useEffectEvent, useRef } from "react";
import { reportStart, reportProgress, reportStopped } from "@/services/playback/reporter";

const PROGRESS_INTERVAL_MS = 5_000;

interface UseReportingSessionArgs {
  mpvRef: NativeMpv | null;
  resolved: ResolvedStream | null;
  baseUrl: string | undefined;
}

export function useReportingSession({ mpvRef, resolved, baseUrl }: UseReportingSessionArgs): void {
  const reportedStartRef = useRef(false);
  const positionRef = useRef(0);
  const isPlayingRef = useRef(false);

  // Stable event handlers — always see latest values, never re-trigger effects
  const onMpvProgress = useEffectEvent((pos: number) => {
    positionRef.current = pos;
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
    reportStopped({
      baseUrl,
      itemId: resolved.mediaSourceId,
      mediaSourceId: resolved.mediaSourceId,
      playSessionId: resolved.playSessionId,
      positionTicks: secondsToTicks(positionRef.current),
    });
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
