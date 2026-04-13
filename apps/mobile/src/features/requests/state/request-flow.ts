import type { MediaServer, SeasonInfo } from "@jellyfuse/models";

/**
 * Pure state machine driving the Jellyseerr request modal. Mirrors
 * `RequestFlow` in `crates/jf-core/src/state.rs::RequestFlow`. Lives
 * inside the modal screen via `useReducer` — there's no reason to
 * promote this to Zustand until a second consumer needs it.
 *
 * Step graph:
 *
 * ```
 * (entry)
 *   │
 *   ├─ TV with seasons  ──► seasons ─► quality ─► submitting ─► done | error
 *   │                          ▲          │
 *   │                          └──────────┘  (back from quality)
 *   │
 *   └─ movie / TV w/o seasons ─► quality ─► submitting ─► done | error
 *                                              │
 *                                              └─ retry on error
 * ```
 *
 * Selection state lives outside the step variant so we don't lose
 * the user's picks if they navigate back. Quality profiles + season
 * data come in via React Query, NOT through actions — the reducer
 * is fed pure user intents.
 */

export type RequestStep = "seasons" | "quality" | "submitting" | "done" | "error";

export interface RequestFlowState {
  step: RequestStep;
  /** Jellyseerr media type. */
  mediaType: "movie" | "tv";
  /** Selected season numbers — TV only. Empty array on movie flows. */
  selectedSeasons: number[];
  /** Selected `(serverId, profileId)` pair, or undefined until the user picks one. */
  selectedProfile: { serverId: number; profileId: number } | undefined;
  /** Last error message, only meaningful when `step === "error"`. */
  errorMessage: string | undefined;
}

export type RequestFlowAction =
  | { type: "TOGGLE_SEASON"; seasonNumber: number }
  | { type: "SELECT_ALL_SEASONS"; seasons: SeasonInfo[] }
  | { type: "CLEAR_SEASONS" }
  | { type: "GO_TO_QUALITY" }
  | { type: "GO_BACK_TO_SEASONS" }
  | { type: "SELECT_PROFILE"; serverId: number; profileId: number }
  | { type: "SUBMIT" }
  | { type: "SUBMIT_SUCCESS" }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "RETRY" };

export interface RequestFlowInit {
  mediaType: "movie" | "tv";
  /**
   * Whether the show needs a season-selection step. False for movies
   * and for TV shows whose season list isn't loaded (we fall straight
   * to the quality step in that case — same behaviour as Rust).
   */
  hasSeasonStep: boolean;
}

export function initRequestFlow(init: RequestFlowInit): RequestFlowState {
  return {
    step: init.hasSeasonStep ? "seasons" : "quality",
    mediaType: init.mediaType,
    selectedSeasons: [],
    selectedProfile: undefined,
    errorMessage: undefined,
  };
}

export function requestFlowReducer(
  state: RequestFlowState,
  action: RequestFlowAction,
): RequestFlowState {
  switch (action.type) {
    case "TOGGLE_SEASON": {
      const exists = state.selectedSeasons.includes(action.seasonNumber);
      const next = exists
        ? state.selectedSeasons.filter((n) => n !== action.seasonNumber)
        : [...state.selectedSeasons, action.seasonNumber].sort((a, b) => a - b);
      return { ...state, selectedSeasons: next };
    }
    case "SELECT_ALL_SEASONS": {
      const requestable = action.seasons
        .filter((s) => s.availability === "missing")
        .map((s) => s.seasonNumber);
      return { ...state, selectedSeasons: requestable };
    }
    case "CLEAR_SEASONS":
      return { ...state, selectedSeasons: [] };
    case "GO_TO_QUALITY":
      return { ...state, step: "quality" };
    case "GO_BACK_TO_SEASONS":
      return { ...state, step: "seasons" };
    case "SELECT_PROFILE":
      return {
        ...state,
        selectedProfile: { serverId: action.serverId, profileId: action.profileId },
      };
    case "SUBMIT":
      return { ...state, step: "submitting", errorMessage: undefined };
    case "SUBMIT_SUCCESS":
      return { ...state, step: "done", errorMessage: undefined };
    case "SUBMIT_ERROR":
      return { ...state, step: "error", errorMessage: action.message };
    case "RETRY":
      return { ...state, step: "quality", errorMessage: undefined };
  }
}

/**
 * Walk the loaded `MediaServer[]` and return the default profile to
 * pre-select. Tries the first server's `defaultProfileId`, falls back
 * to the first profile of the first server. Returns `undefined` when
 * there are no servers / no profiles to pick from — the UI shows an
 * empty state in that case.
 */
export function pickInitialProfile(
  servers: MediaServer[],
): { serverId: number; profileId: number } | undefined {
  for (const server of servers) {
    if (server.defaultProfileId !== undefined) {
      return { serverId: server.id, profileId: server.defaultProfileId };
    }
    const first = server.profiles[0];
    if (first) {
      return { serverId: server.id, profileId: first.id };
    }
  }
  return undefined;
}
