import { useLocalSearchParams } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { PlayerScreen } from "@/features/player/screens/player-screen";

/**
 * Full-screen player route. Presented as a fullScreenModal in the
 * (app) Stack — covers the entire screen including status bar area.
 *
 * Locks to landscape on mount, restores default on unmount.
 * Status bar hidden. Home indicator auto-hides via modal style.
 */
export default function PlayerRoute() {
  const { jellyfinId } = useLocalSearchParams<{ jellyfinId: string }>();

  // Lock to landscape on mount, restore on unmount.
  // This IS a valid useEffect — syncing with an external system
  // (the OS orientation lock), not fetching data or deriving state.
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
    };
  }, []);

  if (!jellyfinId) return null;

  return (
    <>
      <StatusBar hidden />
      <PlayerScreen jellyfinId={jellyfinId} />
    </>
  );
}
