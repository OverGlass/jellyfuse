import {
  DEFAULT_USER_CONFIGURATION,
  fetchUserConfiguration,
  updateUserConfiguration,
  UserConfigurationHttpError,
} from "@jellyfuse/api";
import { bcp47ToIso639_2 } from "@jellyfuse/i18n";
import * as Localization from "expo-localization";
import { apiFetchAuthenticated } from "@/services/api/client";

/**
 * Align the Jellyfin user's `AudioLanguagePreference` and
 * `SubtitleLanguagePreference` with the device's primary language so
 * playback auto-selects tracks in the UI language. Library-level item
 * metadata (movie titles, overviews) is governed by the Jellyfin
 * admin's library `PreferredMetadataLanguage` and is not a user-level
 * setting — the closest user-scoped levers are these two fields plus
 * the request-level `Accept-Language` header.
 *
 * Only writes when the server-side value differs so repeated calls
 * across app launches are free. Best-effort: errors must not block
 * sign-in.
 */
export async function syncMetadataLanguage(args: {
  baseUrl: string;
  userId: string;
}): Promise<void> {
  const osLocale = Localization.getLocales()[0]?.languageCode ?? null;
  const iso = bcp47ToIso639_2(osLocale);

  const current = await fetchUserConfiguration(
    { baseUrl: args.baseUrl, userId: args.userId },
    apiFetchAuthenticated,
  );

  if (current.audioLanguagePreference === iso && current.subtitleLanguagePreference === iso) {
    return;
  }

  const next = {
    ...DEFAULT_USER_CONFIGURATION,
    ...current,
    audioLanguagePreference: iso,
    subtitleLanguagePreference: iso,
  };

  try {
    await updateUserConfiguration(
      { baseUrl: args.baseUrl, userId: args.userId, config: next },
      apiFetchAuthenticated,
    );
  } catch (err) {
    if (err instanceof UserConfigurationHttpError) {
      console.warn("syncMetadataLanguage: server rejected update", err.status);
      return;
    }
    throw err;
  }
}
