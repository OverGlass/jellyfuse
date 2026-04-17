// Jellyfin user-configuration client. Ports the server-side settings
// the app cares about (audio/subtitle preferences, autoplay, remember
// selections, cast receiver, etc.). Source of truth for these values
// lives on the Jellyfin server — reads via `GET /Users/{userId}` and
// writes via `POST /Users/Configuration?userId={guid}`, mirroring the
// Jellyfin web client so edits made here surface across every device
// signed in to the same account.
//
// Shape mirrors `MediaBrowser.Model.Configuration.UserConfiguration`
// in the Jellyfin source 1:1 (PascalCase preserved on the wire, mapped
// to camelCase in the TS type). GUID array fields are passed through
// as `string[]`.

import type { SubtitleMode } from "@jellyfuse/models";
import type { FetchLike } from "./system-info";

/**
 * User-scoped configuration persisted by Jellyfin. Every field mirrors
 * one property on the server-side `UserConfiguration` class.
 *
 * We don't hide/add any fields in transit — the fetchers round-trip the
 * complete shape so subsequent writes don't accidentally null out fields
 * we never surfaced in the UI (Jellyfin's POST endpoint replaces the
 * whole record, not a partial patch).
 */
export interface UserConfiguration {
  /** 3-letter ISO 639 language code, or null when unset. */
  audioLanguagePreference: string | null;
  playDefaultAudioTrack: boolean;
  /** 3-letter ISO 639 language code, or null when unset. */
  subtitleLanguagePreference: string | null;
  displayMissingEpisodes: boolean;
  groupedFolders: string[];
  subtitleMode: SubtitleMode;
  displayCollectionsView: boolean;
  enableLocalPassword: boolean;
  orderedViews: string[];
  latestItemsExcludes: string[];
  myMediaExcludes: string[];
  hidePlayedInLatest: boolean;
  rememberAudioSelections: boolean;
  rememberSubtitleSelections: boolean;
  enableNextEpisodeAutoPlay: boolean;
  castReceiverId: string | null;
}

/** Server-side defaults — used when the server omits optional fields. */
export const DEFAULT_USER_CONFIGURATION: UserConfiguration = {
  audioLanguagePreference: null,
  playDefaultAudioTrack: true,
  subtitleLanguagePreference: null,
  displayMissingEpisodes: false,
  groupedFolders: [],
  subtitleMode: "Default",
  displayCollectionsView: false,
  enableLocalPassword: false,
  orderedViews: [],
  latestItemsExcludes: [],
  myMediaExcludes: [],
  hidePlayedInLatest: true,
  rememberAudioSelections: true,
  rememberSubtitleSelections: true,
  enableNextEpisodeAutoPlay: true,
  castReceiverId: null,
};

export class UserConfigurationHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Jellyfin user-configuration call returned HTTP ${status}`);
    this.name = "UserConfigurationHttpError";
    this.status = status;
  }
}

export class UserConfigurationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserConfigurationParseError";
  }
}

export interface FetchUserConfigurationArgs {
  baseUrl: string;
  userId: string;
}

/**
 * `GET /Users/{userId}` — returns the `UserDto` whose `Configuration`
 * field carries every UI-facing preference. We drop the rest of the
 * `UserDto` (policy, server id, etc.) because the app doesn't use it
 * today; re-add fields here if a future screen needs them.
 */
export async function fetchUserConfiguration(
  args: FetchUserConfigurationArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<UserConfiguration> {
  const url = `${trimTrailingSlash(args.baseUrl)}/Users/${args.userId}`;
  const response = await fetcher(url, signal ? { signal } : undefined);
  if (!response.ok) {
    throw new UserConfigurationHttpError(response.status);
  }
  const raw = (await response.json()) as unknown;
  if (typeof raw !== "object" || raw === null) {
    throw new UserConfigurationParseError("UserDto payload is not an object");
  }
  const dto = raw as { Configuration?: unknown };
  if (typeof dto.Configuration !== "object" || dto.Configuration === null) {
    throw new UserConfigurationParseError("UserDto.Configuration missing");
  }
  return fromServerShape(dto.Configuration as Record<string, unknown>);
}

export interface UpdateUserConfigurationArgs {
  baseUrl: string;
  userId: string;
  config: UserConfiguration;
}

/**
 * `POST /Users/Configuration?userId={guid}` — replaces the whole
 * `UserConfiguration` record for `userId`. Server returns 204 with no
 * body. Callers should pass the full existing record with the targeted
 * field changed; otherwise server-side will overwrite untouched fields
 * with whatever this body contains.
 */
export async function updateUserConfiguration(
  args: UpdateUserConfigurationArgs,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${trimTrailingSlash(args.baseUrl)}/Users/Configuration?userId=${encodeURIComponent(args.userId)}`;

  // Widen fetcher locally — same pattern as `authenticate.ts`. The core
  // `FetchLike` shape is signal-only; Nitro Fetch and `globalThis.fetch`
  // both accept the full init at runtime.
  const wideFetcher = fetcher as (
    input: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body: string;
      signal?: AbortSignal;
    },
  ) => Promise<{ ok: boolean; status: number }>;

  const response = await wideFetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toServerShape(args.config)),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new UserConfigurationHttpError(response.status);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Shape mapping
// ──────────────────────────────────────────────────────────────────────────────

function fromServerShape(raw: Record<string, unknown>): UserConfiguration {
  return {
    audioLanguagePreference: stringOrNull(raw["AudioLanguagePreference"]),
    playDefaultAudioTrack: boolOrDefault(
      raw["PlayDefaultAudioTrack"],
      DEFAULT_USER_CONFIGURATION.playDefaultAudioTrack,
    ),
    subtitleLanguagePreference: stringOrNull(raw["SubtitleLanguagePreference"]),
    displayMissingEpisodes: boolOrDefault(
      raw["DisplayMissingEpisodes"],
      DEFAULT_USER_CONFIGURATION.displayMissingEpisodes,
    ),
    groupedFolders: stringArrayOrEmpty(raw["GroupedFolders"]),
    subtitleMode: parseSubtitleMode(raw["SubtitleMode"]),
    displayCollectionsView: boolOrDefault(
      raw["DisplayCollectionsView"],
      DEFAULT_USER_CONFIGURATION.displayCollectionsView,
    ),
    enableLocalPassword: boolOrDefault(
      raw["EnableLocalPassword"],
      DEFAULT_USER_CONFIGURATION.enableLocalPassword,
    ),
    orderedViews: stringArrayOrEmpty(raw["OrderedViews"]),
    latestItemsExcludes: stringArrayOrEmpty(raw["LatestItemsExcludes"]),
    myMediaExcludes: stringArrayOrEmpty(raw["MyMediaExcludes"]),
    hidePlayedInLatest: boolOrDefault(
      raw["HidePlayedInLatest"],
      DEFAULT_USER_CONFIGURATION.hidePlayedInLatest,
    ),
    rememberAudioSelections: boolOrDefault(
      raw["RememberAudioSelections"],
      DEFAULT_USER_CONFIGURATION.rememberAudioSelections,
    ),
    rememberSubtitleSelections: boolOrDefault(
      raw["RememberSubtitleSelections"],
      DEFAULT_USER_CONFIGURATION.rememberSubtitleSelections,
    ),
    enableNextEpisodeAutoPlay: boolOrDefault(
      raw["EnableNextEpisodeAutoPlay"],
      DEFAULT_USER_CONFIGURATION.enableNextEpisodeAutoPlay,
    ),
    castReceiverId: stringOrNull(raw["CastReceiverId"]),
  };
}

function toServerShape(config: UserConfiguration): Record<string, unknown> {
  return {
    AudioLanguagePreference: config.audioLanguagePreference,
    PlayDefaultAudioTrack: config.playDefaultAudioTrack,
    SubtitleLanguagePreference: config.subtitleLanguagePreference,
    DisplayMissingEpisodes: config.displayMissingEpisodes,
    GroupedFolders: config.groupedFolders,
    SubtitleMode: config.subtitleMode,
    DisplayCollectionsView: config.displayCollectionsView,
    EnableLocalPassword: config.enableLocalPassword,
    OrderedViews: config.orderedViews,
    LatestItemsExcludes: config.latestItemsExcludes,
    MyMediaExcludes: config.myMediaExcludes,
    HidePlayedInLatest: config.hidePlayedInLatest,
    RememberAudioSelections: config.rememberAudioSelections,
    RememberSubtitleSelections: config.rememberSubtitleSelections,
    EnableNextEpisodeAutoPlay: config.enableNextEpisodeAutoPlay,
    CastReceiverId: config.castReceiverId,
  };
}

const SUBTITLE_MODES: SubtitleMode[] = ["Default", "Always", "OnlyForced", "None", "Smart"];

function parseSubtitleMode(value: unknown): SubtitleMode {
  if (typeof value === "string" && (SUBTITLE_MODES as string[]).includes(value)) {
    return value as SubtitleMode;
  }
  return DEFAULT_USER_CONFIGURATION.subtitleMode;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArrayOrEmpty(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
