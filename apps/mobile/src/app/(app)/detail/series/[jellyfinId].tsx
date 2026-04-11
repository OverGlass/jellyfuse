import { useLocalSearchParams } from "expo-router";
import { SeriesDetailScreen } from "@/features/detail/screens/series-detail-screen";

/**
 * `/detail/series/[jellyfinId]` — thin route wrapper that extracts the
 * param and hands it to the pure `<SeriesDetailScreen>`.
 */
export default function SeriesDetailRoute() {
  const { jellyfinId } = useLocalSearchParams<{ jellyfinId: string }>();
  if (!jellyfinId) return null;
  return <SeriesDetailScreen itemId={jellyfinId} />;
}
