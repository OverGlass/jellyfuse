import { HomeScreen } from "@/features/home/screens/home-screen";

/**
 * `(app)` home route. Thin router-facing wrapper around the feature
 * screen — keeps the Expo Router file tree decoupled from the feature
 * folder layout so feature refactors don't force file moves under
 * `app/`.
 */
export default HomeScreen;
