import type { SubtitleMode } from "@jellyfuse/models";
import type { TFunction } from "i18next";
import type { PickerOption } from "../components/settings-picker-modal";

/**
 * Full Jellyfin `SubtitlePlaybackMode` surface, in the same order the
 * Jellyfin web UI presents it. Copy in each sublabel matches the server
 * documentation so behaviour here is identical to other clients.
 */
const SUBTITLE_MODE_VALUES: {
  key: "default" | "always" | "onlyForced" | "smart" | "none";
  value: SubtitleMode;
}[] = [
  { key: "default", value: "Default" },
  { key: "always", value: "Always" },
  { key: "onlyForced", value: "OnlyForced" },
  { key: "smart", value: "Smart" },
  { key: "none", value: "None" },
];

export function subtitleModeOptions(t: TFunction): PickerOption<SubtitleMode>[] {
  return SUBTITLE_MODE_VALUES.map(({ key, value }) => ({
    label: t(`settings.subtitleMode.${key}` as "settings.subtitleMode.default"),
    sublabel: t(`settings.subtitleMode.${key}Sub` as "settings.subtitleMode.defaultSub"),
    value,
  }));
}

export function labelForSubtitleMode(mode: SubtitleMode, t: TFunction): string {
  const match = SUBTITLE_MODE_VALUES.find((o) => o.value === mode);
  if (match) return t(`settings.subtitleMode.${match.key}` as "settings.subtitleMode.default");
  return mode;
}
