// End-of-episode overlay orchestrator. Owns the store + progress
// SharedValue via useEndOfEpisodeFlow, then renders one of three
// branches based on the current phase. Re-renders only on phase
// transitions — countdown progress flows through the renderer thread
// via the SharedValue, never through React.

import type { MediaItem } from "@jellyfuse/models";
import { useMemo, useSyncExternalStore } from "react";
import type { SharedValue } from "react-native-reanimated";
import { useEndOfEpisodeFlow } from "../hooks/use-end-of-episode-flow";
import {
  EndOfEpisodeProvider,
  type EndOfEpisodeContextValue,
} from "../state/end-of-episode-context";
import { CreditsPair } from "./credits-pair";
import { NearEndPill } from "./near-end-pill";

interface Props {
  positionShared: SharedValue<number>;
  durationShared: SharedValue<number>;
  creditsSegment: { start: number; end: number } | undefined;
  nextEpisode: MediaItem | undefined;
  isPlaying: boolean;
  onAutoplay: () => void;
}

export function EndOfEpisodeOverlay({
  positionShared,
  durationShared,
  creditsSegment,
  nextEpisode,
  isPlaying,
  onAutoplay,
}: Props) {
  const { store, progressShared } = useEndOfEpisodeFlow({
    positionShared,
    durationShared,
    creditsSegment,
    hasNext: nextEpisode !== undefined,
    isPlaying,
    onAutoplay,
  });
  const phase = useSyncExternalStore(store.subscribe, () => store.getSnapshot().phase);
  // store + progressShared are both stable for the life of the
  // overlay; memoise the pair so the Provider value identity doesn't
  // churn — leaves stay subscribed without re-rendering on parent
  // updates.
  const ctx = useMemo<EndOfEpisodeContextValue>(
    () => ({ store, progressShared }),
    [store, progressShared],
  );
  if (phase === "idle" || nextEpisode === undefined) return null;
  return (
    <EndOfEpisodeProvider value={ctx}>
      {phase === "credits" ? (
        <CreditsPair nextEpisode={nextEpisode} onAutoplay={onAutoplay} />
      ) : (
        <NearEndPill nextEpisode={nextEpisode} onAutoplay={onAutoplay} />
      )}
    </EndOfEpisodeProvider>
  );
}
