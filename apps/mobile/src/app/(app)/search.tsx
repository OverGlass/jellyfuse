import { SearchScreen } from "@/features/search/screens/search-screen";

/**
 * `(app)/search` route. Thin router-facing wrapper around the
 * feature screen — keeps the Expo Router file tree decoupled from
 * the feature folder layout. Mirrors the same pattern as
 * `(app)/index.tsx` for home.
 *
 * Currently a flat route under `(app)`, reached from the search
 * icon in the home header. Will move under a `(tabs)` group when
 * the bottom tab bar lands in a later phase.
 */
export default SearchScreen;
