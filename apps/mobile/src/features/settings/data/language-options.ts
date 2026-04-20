import type { TFunction } from "i18next";
import type { PickerOption } from "../components/settings-picker-modal";

/**
 * Curated ISO 639-2 language options for audio/subtitle preference
 * pickers. The list is intentionally finite — the Jellyfin server
 * stores a free-form 3-letter code, but the UI only surfaces the
 * languages users are likely to pick. Power users who need an
 * exotic code can still set it on the Jellyfin web UI; we round-trip
 * any value we don't recognise rather than overwriting it.
 *
 * First entry is an `""` sentinel meaning "no preference" — matches
 * Jellyfin's behaviour when the field is null/empty (mpv picks based
 * on the track's `isDefault` flag).
 */
const LANGUAGE_VALUES: { key: string; value: string }[] = [
  { key: "english", value: "eng" },
  { key: "french", value: "fre" },
  { key: "spanish", value: "spa" },
  { key: "german", value: "ger" },
  { key: "italian", value: "ita" },
  { key: "portuguese", value: "por" },
  { key: "japanese", value: "jpn" },
  { key: "korean", value: "kor" },
  { key: "chineseMandarin", value: "chi" },
  { key: "russian", value: "rus" },
  { key: "arabic", value: "ara" },
  { key: "dutch", value: "dut" },
  { key: "polish", value: "pol" },
  { key: "swedish", value: "swe" },
  { key: "norwegian", value: "nor" },
  { key: "danish", value: "dan" },
  { key: "finnish", value: "fin" },
  { key: "turkish", value: "tur" },
  { key: "hindi", value: "hin" },
];

export function languageOptions(t: TFunction): PickerOption<string>[] {
  return [
    { label: t("settings.language.autoLabel"), value: "" },
    ...LANGUAGE_VALUES.map(({ key, value }) => ({
      label: t(`settings.language.${key}` as "settings.language.english"),
      value,
    })),
  ];
}

/**
 * Return the human label for a code — falls back to the code itself
 * (uppercased) when not in our curated list, so foreign-authored
 * configs still render something sensible.
 */
export function labelForLanguageCode(code: string | null | undefined, t: TFunction): string {
  if (!code) return t("settings.language.auto");
  const match = LANGUAGE_VALUES.find((o) => o.value === code);
  if (match) return t(`settings.language.${match.key}` as "settings.language.english");
  return code.toUpperCase();
}
