// Tiny Context so leaves (CreditsPair, NearEndPill, CountdownPill)
// can reach the store and progressShared without prop-drilling. Two
// values, both stable for the life of EndOfEpisodeOverlay — Context
// re-renders only when the provider's value object identity changes,
// which is never under steady state.

import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";
import type { EndOfEpisodeStore } from "./end-of-episode-store";

export interface EndOfEpisodeContextValue {
  store: EndOfEpisodeStore;
  progressShared: SharedValue<number>;
}

const EndOfEpisodeContext = createContext<EndOfEpisodeContextValue | null>(null);

export const EndOfEpisodeProvider = EndOfEpisodeContext.Provider;

export function useEndOfEpisode(): EndOfEpisodeContextValue {
  const ctx = useContext(EndOfEpisodeContext);
  if (ctx === null) {
    throw new Error("useEndOfEpisode must be used inside <EndOfEpisodeOverlay>");
  }
  return ctx;
}
