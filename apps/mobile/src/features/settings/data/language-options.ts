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
export const LANGUAGE_OPTIONS: PickerOption<string>[] = [
  { label: "Auto (no preference)", value: "" },
  { label: "English", value: "eng" },
  { label: "French", value: "fre" },
  { label: "Spanish", value: "spa" },
  { label: "German", value: "ger" },
  { label: "Italian", value: "ita" },
  { label: "Portuguese", value: "por" },
  { label: "Japanese", value: "jpn" },
  { label: "Korean", value: "kor" },
  { label: "Chinese (Mandarin)", value: "chi" },
  { label: "Russian", value: "rus" },
  { label: "Arabic", value: "ara" },
  { label: "Dutch", value: "dut" },
  { label: "Polish", value: "pol" },
  { label: "Swedish", value: "swe" },
  { label: "Norwegian", value: "nor" },
  { label: "Danish", value: "dan" },
  { label: "Finnish", value: "fin" },
  { label: "Turkish", value: "tur" },
  { label: "Hindi", value: "hin" },
];

/**
 * Return the human label for a code — falls back to the code itself
 * (uppercased) when not in our curated list, so foreign-authored
 * configs still render something sensible.
 */
export function labelForLanguageCode(code: string | null | undefined): string {
  if (!code) return "Auto";
  const match = LANGUAGE_OPTIONS.find((o) => o.value === code);
  if (match) return match.label;
  return code.toUpperCase();
}
