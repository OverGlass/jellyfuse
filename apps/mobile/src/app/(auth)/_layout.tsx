import { Stack } from "expo-router";

/**
 * `(auth)` route group — server connect and sign in. The profile
 * picker lives at the root level (not here) so it can be presented
 * as a modal over `(app)` from the home header — see the root
 * `_layout.tsx` for the modal screen registration.
 *
 * No state-based redirects here: the root `app/index.tsx` owns the
 * single routing decision tree.
 */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
