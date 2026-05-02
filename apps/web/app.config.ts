import type { ExpoConfig, ConfigContext } from "expo/config";

// GitHub Pages serves the marketing site at https://overglass.github.io/jellyfuse/
// — keep the baseUrl pinned to the project subpath so static assets resolve.
// The Jekyll-served privacy page (docs/privacy.md → /privacy.html) lives
// under the same origin from a different branch (gh-pages serves the
// marketing build, main/docs serves /privacy.html via Jekyll).
const baseUrl = process.env.WEB_BASE_URL ?? "/jellyfuse";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Jellyfuse",
  slug: "jellyfuse-web",
  version: "1.0.0",
  scheme: "jellyfuse",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  icon: "./public/icon.png",
  backgroundColor: "#1e2227",
  web: {
    output: "static",
    bundler: "metro",
    favicon: "./public/favicon.png",
  },
  plugins: ["expo-router"],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
    baseUrl,
  },
  extra: {
    router: {},
  },
});
