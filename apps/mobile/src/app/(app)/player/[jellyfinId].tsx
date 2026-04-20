import { useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PlayerScreen } from "@/features/player/screens/player-screen";

/**
 * Full-screen player route. Presented as a fullScreenModal in the
 * (app) Stack — covers the entire screen including status bar area.
 *
 * Orientation is unlocked — the device's own orientation setting
 * decides. Status bar hidden. Home indicator auto-hides via modal style.
 *
 * `fullScreenModal` mounts this route in a separate native
 * UIViewController, so the root `SafeAreaProvider` can't observe its
 * view and insets never update on rotation. Wrapping the screen in its
 * own provider makes `useSafeAreaInsets()` track the player's own
 * window — so the title block / bottom row follow the notch when the
 * device rotates.
 */
export default function PlayerRoute() {
  const { jellyfinId } = useLocalSearchParams<{ jellyfinId: string }>();

  if (!jellyfinId) return null;

  return (
    <SafeAreaProvider>
      <StatusBar hidden />
      <PlayerScreen jellyfinId={jellyfinId} />
    </SafeAreaProvider>
  );
}
