// Map BCP-47 locale tags (as returned by `expo-localization`) to the
// ISO-639-2/T 3-letter codes Jellyfin uses for `PreferredMetadataLanguage`
// and `PreferredSubtitleLanguage`. Covers the languages we ship UI
// translations for; unknown codes fall back to English ("eng").

const BCP47_TO_ISO639_2: Record<string, string> = {
  en: "eng",
  fr: "fra",
  es: "spa",
  de: "deu",
  it: "ita",
  pt: "por",
  ja: "jpn",
  zh: "zho",
  ko: "kor",
  nl: "nld",
  sv: "swe",
  pl: "pol",
  ru: "rus",
  ar: "ara",
  he: "heb",
  tr: "tur",
  cs: "ces",
  da: "dan",
  fi: "fin",
  nb: "nor",
  uk: "ukr",
};

export function bcp47ToIso639_2(languageCode: string | null | undefined): string {
  if (!languageCode) return "eng";
  const primary = languageCode.split(/[-_]/)[0]?.toLowerCase();
  if (!primary) return "eng";
  return BCP47_TO_ISO639_2[primary] ?? "eng";
}

// BCP-47 primary subtags we currently ship a catalog for. Every entry
// must have a matching `src/locales/<code>.json` so the lazy loader
// doesn't throw at runtime. Expand this list as translations land.
export const SUPPORTED_LOCALES = ["en", "fr"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function resolveLocale(languageCode: string | null | undefined): SupportedLocale {
  if (!languageCode) return "en";
  const primary = languageCode.split(/[-_]/)[0]?.toLowerCase();
  if (primary && (SUPPORTED_LOCALES as readonly string[]).includes(primary)) {
    return primary as SupportedLocale;
  }
  return "en";
}
