import { useLocalSearchParams } from "expo-router";
import { TmdbDetailScreen } from "@/features/detail/screens/tmdb-detail-screen";

/**
 * `/detail/tmdb/[tmdbId]` — TMDB-only detail for Jellyseerr items not
 * yet in the Jellyfin library. Reached from the requests list and from
 * Jellyseerr search results. The `mediaType` param (`"movie" | "tv"`)
 * is required to call the right Jellyseerr endpoint.
 */
export default function TmdbDetailRoute() {
  const params = useLocalSearchParams<{ tmdbId: string; mediaType?: string }>();
  const tmdbId = Number.parseInt(params.tmdbId ?? "0", 10);
  const mediaType: "movie" | "tv" = params.mediaType === "tv" ? "tv" : "movie";
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
    return null;
  }
  return <TmdbDetailScreen tmdbId={tmdbId} mediaType={mediaType} />;
}
