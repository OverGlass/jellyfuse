import type { SubtitleMode } from "@jellyfuse/models";
import type { PickerOption } from "../components/settings-picker-modal";

/**
 * Full Jellyfin `SubtitlePlaybackMode` surface, in the same order the
 * Jellyfin web UI presents it. Copy in each sublabel matches the server
 * documentation so behaviour here is identical to other clients.
 */
export const SUBTITLE_MODE_OPTIONS: PickerOption<SubtitleMode>[] = [
  { label: "Default", sublabel: "Use the track marked default", value: "Default" },
  { label: "Always", sublabel: "Show subtitles whenever available", value: "Always" },
  {
    label: "Only forced",
    sublabel: "Show forced subtitles only (foreign dialog)",
    value: "OnlyForced",
  },
  {
    label: "Smart",
    sublabel: "Show subtitles when audio language differs from your preference",
    value: "Smart",
  },
  { label: "None", sublabel: "Disable subtitles", value: "None" },
];

export function labelForSubtitleMode(mode: SubtitleMode): string {
  const match = SUBTITLE_MODE_OPTIONS.find((o) => o.value === mode);
  return match?.label ?? mode;
}
