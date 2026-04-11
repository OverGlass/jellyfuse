import { Redirect } from "expo-router";
import { useAuth } from "@/services/auth/state";

/**
 * Root route. Redirects into the correct route group based on auth state.
 * Auth-group vs app-group layouts handle all per-group concerns; this
 * screen is just the entry-point switch.
 */
export default function IndexRoute() {
  const { status } = useAuth();
  if (status === "authenticated") {
    return <Redirect href="/(app)" />;
  }
  return <Redirect href="/(auth)/sign-in" />;
}
