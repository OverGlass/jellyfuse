import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/services/auth/state";

/**
 * `(auth)` route group — server connect, sign in, profile picker.
 * If the user is already authenticated, bounce them out to `(app)`.
 */
export default function AuthLayout() {
  const { status } = useAuth();
  if (status === "authenticated") {
    return <Redirect href="/(app)" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
