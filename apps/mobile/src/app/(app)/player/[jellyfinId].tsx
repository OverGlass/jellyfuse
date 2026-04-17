import { useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PlayerScreen } from "@/features/player/screens/player-screen";

/**
 * Full-screen player route. Presented as a fullScreenModal in the
 * (app) Stack — covers the entire screen including status bar area.
 *
 * Orientation is unlocked — the device's own orientation setting
 * decides. Status bar hidden. Home indicator auto-hides via modal style.
 */
export default function PlayerRoute() {
  const { jellyfinId } = useLocalSearchParams<{ jellyfinId: string }>();

  if (!jellyfinId) return null;

  return (
    <>
      <StatusBar hidden />
      <PlayerScreen jellyfinId={jellyfinId} />
    </>
  );
}
