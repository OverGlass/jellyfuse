import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/services/auth/state";

/**
 * `(auth)` route group — server connect, sign in, profile picker.
 * If the user is already authenticated, bounce them out to `(app)`.
 */
export default function AuthLayout() {
  const { status } = useAuth();
  if (status === "authenticated") {
    // Bounce back to the root router — single source of routing
    // truth, mirrors the pattern in (app)/_layout.tsx.
    return <Redirect href="/" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}
