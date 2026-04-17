import { DEFAULT_USER_CONFIGURATION, type UserConfiguration } from "@jellyfuse/api";
import { useUserConfiguration } from "@/services/query/hooks/use-user-configuration";
import type { ResolverSettings } from "@/services/playback/resolver";

/**
 * Project settings that matter to the playback resolver, sourced from
 * the server-persisted `UserConfiguration` and defaulted when the
 * server copy hasn't loaded yet.
 *
 * Returning defaults (instead of `undefined`) during the initial fetch
 * means the resolver never sees an empty audio-language string when
 * the cache is warm from the persister — if the user just opened the
 * app offline, they get the Jellyfin defaults (no language preference,
 * subtitle mode `Default`) rather than an error. The next online
 * revalidation will swap in the user's real preferences.
 */
export function useResolverSettings(): ResolverSettings {
  const query = useUserConfiguration();
  const config: UserConfiguration = query.data ?? DEFAULT_USER_CONFIGURATION;
  return {
    preferredAudioLanguage: config.audioLanguagePreference ?? "",
    preferredSubtitleLanguage: config.subtitleLanguagePreference ?? "",
    subtitleMode: config.subtitleMode,
  };
}
