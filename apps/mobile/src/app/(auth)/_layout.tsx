import { Stack } from "expo-router";

/**
 * `(auth)` route group — server connect, sign in, profile picker.
 *
 * No state-based redirects here: the root `app/index.tsx` owns the
 * single routing decision tree, and the profile picker is reachable
 * from the home header avatar button even while the user is
 * authenticated. A layout-level `<Redirect>` to `/` here would break
 * that "switch user" flow the moment the authenticated user tapped
 * the button.
 */
export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
