import type { TFunction } from "i18next";
import type { PickerOption } from "../components/settings-picker-modal";

/**
 * Streaming bitrate caps in Mbps. Matches Jellyfin web's "Internet
 * quality" dropdown. Value 0 is the "Auto" sentinel — stored as
 * `undefined` in MMKV but represented as 0 in the picker so the
 * `PickerOption<number>` type stays concrete.
 *
 * The cap flows into `fetchPlaybackInfo` as `maxBitrate` (Mbps ×
 * 1_000_000 → bits per second) so the server picks transcode vs
 * DirectPlay against the user's network ceiling.
 */
const BITRATE_VALUES: { value: number; label: string }[] = [
  { label: "Highest (120 Mbps)", value: 120 },
  { label: "40 Mbps", value: 40 },
  { label: "20 Mbps", value: 20 },
  { label: "15 Mbps", value: 15 },
  { label: "10 Mbps", value: 10 },
  { label: "8 Mbps", value: 8 },
  { label: "6 Mbps", value: 6 },
  { label: "4 Mbps", value: 4 },
  { label: "3 Mbps", value: 3 },
  { label: "2 Mbps", value: 2 },
  { label: "1.5 Mbps", value: 1.5 },
  { label: "1 Mbps", value: 1 },
  { label: "720 Kbps", value: 0.72 },
  { label: "420 Kbps", value: 0.42 },
];

export function streamingBitrateOptions(t: TFunction): PickerOption<number>[] {
  return [
    { label: t("settings.bitrate.auto"), sublabel: t("settings.bitrate.autoHint"), value: 0 },
    ...BITRATE_VALUES,
  ];
}

export function labelForBitrate(mbps: number | undefined, t: TFunction): string {
  if (mbps === undefined) return t("settings.bitrate.auto");
  const match = BITRATE_VALUES.find((o) => o.value === mbps);
  if (match) return match.label;
  return `${mbps} Mbps`;
}
