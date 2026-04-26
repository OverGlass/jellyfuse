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
 * - series with at least one watched episode → badge hides. We detect
 *                                this from either `unplayedItemCount <
 *                                episodeCount` (Jellyfin's series-level
 *                                signal, present on `/Items/Latest` and
 *                                `/Items?SortBy=DateCreated` payloads
 *                                where `playCount` is left at 0), or
 *                                `playCount > 0` (set on series UserData
 *                                from richer endpoints such as the
 *                                detail screen). Either signal alone is
 *                                sufficient. Only honored for
 *                                `mediaType === "series"`; on a single
 *                                video an episode's `PlayCount` is just
 *                                a re-watch counter and shouldn't
 *                                suppress the badge for a freshly-
 *                                unmarked episode.
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
   * Item kind. `playCount` / `unplayedItemCount` are only treated as
   * "in progress" signals when this is `"series"`; on movies /
   * episodes those fields don't carry the same meaning.
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
  mediaType,
  size = 18,
}: Props) {
  if (played !== false) return null;
  if ((progress ?? 0) > 0.01) return null;
  if (mediaType === "series" && isSeriesInProgress(unplayedItemCount, episodeCount, playCount)) {
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

function isSeriesInProgress(
  unplayedItemCount: number | undefined,
  episodeCount: number | undefined,
  playCount: number | undefined,
): boolean {
  if (
    unplayedItemCount !== undefined &&
    episodeCount !== undefined &&
    unplayedItemCount < episodeCount
  ) {
    return true;
  }
  return (playCount ?? 0) > 0;
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
