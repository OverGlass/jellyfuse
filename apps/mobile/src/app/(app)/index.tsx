import { Redirect } from "expo-router";

/**
 * Root route for the `(app)` group. Immediately redirects to the
 * tabs home so the bottom tab bar is always present once the user
 * is authenticated. Keeping this file as a redirect (rather than
 * deleting it) preserves the Stack's default segment and prevents
 * Expo Router from falling through to the auth group.
 */
export default function AppIndex() {
  return <Redirect href="/home" />;
}
