import { useLocalSearchParams } from "expo-router";
import { RequestFlowScreen } from "@/features/requests/screens/request-flow-screen";

/**
 * `(app)/request/[tmdbId]` route. Thin router-facing wrapper around
 * the feature screen. Presented as `formSheet` from the parent
 * `(app)/_layout.tsx` so the OS gives us:
 *
 * - iPhone → bottom sheet with detents (native iOS sheet)
 * - iPad → centered floating card
 * - Mac Catalyst → modal window
 * - Android → standard modal
 *
 * Query params:
 * - `mediaType`: `"movie" | "tv"` (defaults to `"movie"`)
 * - `title`: display name of the item (rendered in the sheet header)
 *
 * Both come from the search row tap on the home screen, which has
 * the full `MediaItem` in hand. We pass them as query params instead
 * of pulling the item from a global store so the route is pure and
 * deep-linkable.
 */
export default function RequestRoute() {
  const params = useLocalSearchParams<{
    tmdbId: string;
    mediaType?: string;
    title?: string;
  }>();
  const tmdbId = Number.parseInt(params.tmdbId ?? "0", 10);
  const mediaType: "movie" | "tv" = params.mediaType === "tv" ? "tv" : "movie";
  const title = params.title ?? "";
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
    return null;
  }
  return <RequestFlowScreen tmdbId={tmdbId} mediaType={mediaType} title={title} />;
}
