import type { MediaType } from "@jellyfuse/models";
import { colors } from "@jellyfuse/theme";
import { StyleSheet, View } from "react-native";

/**
 * Folded-corner ribbon that overlays the top-right of a media card or
 * thumbnail when the active user has not started the item. Pure marker:
 * - `played === true`         → badge hides (already watched)
 * - `played === undefined`    → badge hides (Jellyseerr-only items, no play state)
 * - `progress > 0`            → badge hides (resume point on a video — in
 *                                progress, conveyed by the progress bar)
 * - series / season with at least one watched OR in-progress episode →
 *                                badge hides. Three signals — any one is
 *                                sufficient:
 *                                  1. `unplayedItemCount < episodeCount`
 *                                     (Jellyfin's aggregate signal,
 *                                      present on `/Items/Latest` etc.;
 *                                      only ticks down when an episode
 *                                      is **fully** played, not while
 *                                      mid-watch).
 *                                  2. `playCount > 0` (set on aggregate
 *                                     UserData from richer endpoints).
 *                                  3. `lastPlayedDate !== undefined`
 *                                     (set by Jellyfin the moment any
 *                                      episode is started — this is
 *                                      what catches "S1E1 is mid-watch",
 *                                      since neither (1) nor (2) flip
 *                                      until the episode finishes).
 *                                Only honored for `mediaType ===
 *                                "series"` and `mediaType === "season"`;
 *                                on a single video an episode's
 *                                `PlayCount` / `LastPlayedDate` apply
 *                                to that single video, not to a
 *                                "container is in progress" notion.
 * - otherwise                 → badge shows
 *
 * Drawn as a square rotated 45° behind a square clip, so half the
 * rotated square spills off the parent and only the top-right triangle
 * is visible. Cheap, no `react-native-svg` dep, and clips cleanly under
 * the parent's `borderRadius` because the wrapper's `overflow: hidden`
 * is what bounds it.
 */
interface Props {
  /** `true` when the active user has played the item — badge hides. */
  played: boolean | undefined;
  /**
   * 0–1 resume progress on a video item. When `> 0` the item is mid-
   * watch (movie / episode), already conveyed by the bottom progress
   * bar — the unplayed badge would be redundant, so it hides.
   */
  progress?: number | undefined;
  /**
   * `UserData.PlayCount`. Only consulted for series — see prop docs.
   * Pass through unconditionally; the component gates the use itself.
   */
  playCount?: number | undefined;
  /**
   * `UserData.UnplayedItemCount` — episodes the user hasn't watched
   * yet. Only meaningful on series. Combined with `episodeCount` to
   * detect "some, but not all, episodes watched" on shelf payloads
   * where Jellyfin leaves `playCount` at 0.
   */
  unplayedItemCount?: number | undefined;
  /** Total episode count for series cards (`MediaItem.episodeCount`). */
  episodeCount?: number | undefined;
  /**
   * `UserData.LastPlayedDate` ISO string. For aggregate items (series
   * / season) any non-undefined value means the user has at least
   * started one episode — Jellyfin stamps this on the parent
   * immediately on episode-start, before `PlayCount` or
   * `UnplayedItemCount` would change.
   */
  lastPlayedDate?: string | undefined;
  /**
   * Item kind. `playCount` / `unplayedItemCount` are only treated as
   * "in progress" signals when this is `"series"` or `"season"`; on
   * movies / episodes those fields don't carry the same meaning.
   */
  mediaType?: MediaType | undefined;
  /** Edge length of the visible triangle in pt. Defaults to 18. */
  size?: number;
}

export function UnplayedCornerBadge({
  played,
  progress,
  playCount,
  unplayedItemCount,
  episodeCount,
  lastPlayedDate,
  mediaType,
  size = 18,
}: Props) {
  if (played !== false) return null;
  if ((progress ?? 0) > 0.01) return null;
  if (
    (mediaType === "series" || mediaType === "season") &&
    isAggregateInProgress(unplayedItemCount, episodeCount, playCount, lastPlayedDate)
  ) {
    return null;
  }
  // The clip is `size × size`; the rotated square is `size√2` on each
  // side and offset so its bottom-left corner lands in the visible
  // triangle's centre. The math: a 45°-rotated square of side `s` has
  // a bounding box of `s√2 × s√2`; placing it with `top: -s/√2` and
  // `right: -s/√2` makes only the bottom-left half visible inside
  // the clip's top-right corner.
  const inner = size * Math.SQRT2;
  const offset = -size / Math.SQRT2;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={[styles.clip, { width: size, height: size }]}
    >
      <View
        style={[
          styles.fold,
          {
            width: inner,
            height: inner,
            top: offset,
            right: offset,
          },
        ]}
      />
    </View>
  );
}

function isAggregateInProgress(
  unplayedItemCount: number | undefined,
  episodeCount: number | undefined,
  playCount: number | undefined,
  lastPlayedDate: string | undefined,
): boolean {
  if (
    unplayedItemCount !== undefined &&
    episodeCount !== undefined &&
    unplayedItemCount < episodeCount
  ) {
    return true;
  }
  if ((playCount ?? 0) > 0) return true;
  // Jellyfin stamps `LastPlayedDate` on the parent series the moment
  // an episode is *started* (before PlayCount / UnplayedItemCount
  // change). Catches the "one episode mid-watch" case.
  return lastPlayedDate !== undefined;
}

const styles = StyleSheet.create({
  clip: {
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
  },
  fold: {
    backgroundColor: colors.accent,
    position: "absolute",
    transform: [{ rotate: "45deg" }],
  },
});
