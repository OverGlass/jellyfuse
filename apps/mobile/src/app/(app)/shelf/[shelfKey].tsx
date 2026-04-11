import type { ShelfKey } from "@jellyfuse/query-keys";
import { useLocalSearchParams } from "expo-router";
import { ShelfScreen } from "@/features/home/screens/shelf-screen";

/**
 * `/shelf/[shelfKey]` — thin route wrapper that reads the typed
 * shelf key param and hands it to the pure `<ShelfScreen>`.
 */
const VALID_KEYS: readonly ShelfKey[] = [
  "continue-watching",
  "next-up",
  "recently-added",
  "latest-movies",
  "latest-tv",
  "suggestions",
] as const;

function isShelfKey(value: string): value is ShelfKey {
  return (VALID_KEYS as readonly string[]).includes(value);
}

export default function ShelfRoute() {
  const { shelfKey } = useLocalSearchParams<{ shelfKey: string }>();
  if (!shelfKey || !isShelfKey(shelfKey)) return null;
  return <ShelfScreen shelfKey={shelfKey} />;
}
