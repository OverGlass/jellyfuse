import type { FetchLike } from "@jellyfuse/api";
import { fetch as nitroFetch } from "react-native-nitro-fetch";

/**
 * App-side HTTP fetcher. Always routed through `react-native-nitro-fetch`
 * per CLAUDE.md's "No raw `fetch`" rule — Nitro Fetch uses URLSession on
 * iOS / tvOS / Catalyst and Cronet on Android under the hood, supports
 * HTTP/2 + HTTP/3, and runs on the native thread so we don't block JS.
 *
 * This module is the **single entry point** for HTTP in the app; every
 * `@jellyfuse/api` call site receives this function. Packages in
 * `packages/api` stay pure TS and take the fetcher as an argument,
 * which keeps them unit-testable against MSW / fake fetchers in Vitest.
 */
export const apiFetch: FetchLike = (input, init) => {
  return nitroFetch(input, init);
};
