// Redirect stub — the tabs group uses named routes (home, settings)
// so the Stack's (app)/index.tsx at URL "/" can redirect to "/home"
// without a route conflict. This file exists to satisfy Expo Router's
// file-system expectations but is hidden from the tab bar and should
// never be reached at runtime.
import { Redirect } from "expo-router";

export default function TabsIndex() {
  return <Redirect href="/home" />;
}
