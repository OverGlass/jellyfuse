import { storage } from "@/services/query/storage";

/**
 * MMKV-backed *local* user settings — the subset of preferences
 * Jellyfin's `UserConfiguration` schema has no field for. Everything
 * with a matching server field lives on Jellyfin via
 * `@jellyfuse/api::UserConfiguration`, not here; see
 * `services/query/hooks/use-user-configuration.ts`.
 *
 * Keyed per-user so different profiles on the same device can have
 * different bitrate caps (e.g. "parent on unlimited cellular" + "kid
 * on strict mobile data"). Purged alongside the user record in the
 * sign-out / remove-user flow.
 *
 * All fields are kept nullable: `undefined` means "use the default /
 * auto". Persisting "auto" explicitly avoids the need for a magic
 * sentinel in the UI — the picker just reads `?? undefined`.
 */

export const LOCAL_SETTINGS_KEY_PREFIX = "local-settings:v1:";

/** Exported so the React hook can filter the MMKV value-changed listener. */
export function localSettingsMmkvKey(userId: string): string {
  return `${LOCAL_SETTINGS_KEY_PREFIX}${userId}`;
}

export interface LocalSettings {
  /**
   * Max streaming bitrate cap for the current network. Mirrors Jellyfin
   * web's local "Internet quality" preference. `undefined` = auto
   * (let Jellyfin pick based on the `PlaybackInfo` response).
   */
  maxStreamingBitrateMbps: number | undefined;
}

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  maxStreamingBitrateMbps: undefined,
};

export function readLocalSettings(userId: string): LocalSettings {
  const raw = storage.getString(localSettingsMmkvKey(userId));
  if (!raw) return DEFAULT_LOCAL_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalSettings>;
    return {
      maxStreamingBitrateMbps:
        typeof parsed.maxStreamingBitrateMbps === "number"
          ? parsed.maxStreamingBitrateMbps
          : undefined,
    };
  } catch {
    return DEFAULT_LOCAL_SETTINGS;
  }
}

export function writeLocalSettings(userId: string, next: LocalSettings): void {
  storage.set(localSettingsMmkvKey(userId), JSON.stringify(next));
}

/** Drop the local settings for a single user — used on user removal. */
export function clearLocalSettings(userId: string): void {
  storage.remove(localSettingsMmkvKey(userId));
}

/** Drop every user's local settings — used on sign-out / reset. */
export function clearAllLocalSettings(): void {
  const keys = storage.getAllKeys().filter((k) => k.startsWith(LOCAL_SETTINGS_KEY_PREFIX));
  for (const k of keys) storage.remove(k);
}
