import { useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PlayerScreen } from "@/features/player/screens/player-screen";

/**
 * Full-screen player route. Presented as a fullScreenModal in the
 * (app) Stack — covers the entire screen including status bar area.
 *
 * The status bar is hidden while the player is mounted. The home
 * indicator auto-hides via the modal presentation style.
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
