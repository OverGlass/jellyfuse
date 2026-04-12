import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * Dynamic Expo config.
 *
 * Migrated from app.json in Phase 0b.3 so we can express environment
 * branches (EXPO_TV, production vs dev bundle id, Mac Catalyst) without
 * shelling to multiple json files. Phase 7 adds the tvOS / Android TV
 * branch via `process.env.EXPO_TV === "1"`, and Phase 8 adds the Mac
 * Catalyst branch. For Phase 0b.3 the config is a straight port of
 * app.json with no branching yet.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Jellyfuse",
  slug: "jellyfuse",
  owner: "arkbase",
  version: "0.0.0",
  orientation: "default",
  scheme: "jellyfuse",
  userInterfaceStyle: "automatic",
  icon: "./assets/images/icon.png",
  ios: {
    bundleIdentifier: "com.jellyfuse.app",
    supportsTablet: true,
    appleTeamId: "39TMVBW2CY",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.jellyfuse.app",
    adaptiveIcon: {
      backgroundColor: "#000000",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: true,
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#000000",
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: "39dc1c25-4366-41f4-bcc8-1257afc85d72",
    },
  },
});
