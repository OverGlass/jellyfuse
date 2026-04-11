import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/services/auth/state";

/**
 * `(app)` route group — the protected area. Home, detail, player, search,
 * downloads, settings, requests. Unauthenticated users get kicked back to
 * the auth group.
 */
export default function AppLayout() {
  const { status } = useAuth();
  if (status !== "authenticated") {
    return <Redirect href="/(auth)/sign-in" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
