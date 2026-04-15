import { RequestsScreen } from "@/features/requests/screens/requests-screen";

/**
 * `(app)/requests` route. Thin router-facing wrapper around the
 * feature screen — keeps the Expo Router file tree decoupled from
 * the feature folder layout. Reached from the "Requests" shortcut
 * in the home header when Jellyseerr is connected; will move under
 * a `(tabs)` group if / when the bottom tab bar lands.
 */
export default RequestsScreen;
