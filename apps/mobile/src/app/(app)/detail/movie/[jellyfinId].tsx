import { useLocalSearchParams } from "expo-router";
import { MovieDetailScreen } from "@/features/detail/screens/movie-detail-screen";

/**
 * `/detail/movie/[jellyfinId]` — thin route wrapper that extracts the
 * param and hands it to the pure `<MovieDetailScreen>`. The screen
 * handles its own loading / error states, so no orchestration here.
 */
export default function MovieDetailRoute() {
  const { jellyfinId } = useLocalSearchParams<{ jellyfinId: string }>();
  if (!jellyfinId) return null;
  return <MovieDetailScreen itemId={jellyfinId} />;
}
