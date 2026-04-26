import type { ExpoConfig, ConfigContext } from "expo/config";

const isProduction = process.env.EXPO_PUBLIC_ENV === "production";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Jellyfuse",
  slug: "jellyfuse",
  // Owner and projectId are env-driven so a fork can ship to its own EAS
  // project without editing this file. Set EAS_OWNER and EAS_PROJECT_ID
  // in your .env (op:// references are wired in .env.tpl).
  owner: process.env.EAS_OWNER,
  version: "1.0.0",
  orientation: "default",
  scheme: "jellyfuse",
  userInterfaceStyle: "automatic",
  icon: "./assets/images/icon.png",
  // Native window background — used by iOS for the close-to-icon
  // (genie) animation snapshot and the app switcher, and by Android
  // for the window background. Without this, iOS falls back to white
  // during the close animation. Wired through expo-system-ui at
  // native build time, so requires a rebuild to take effect.
  backgroundColor: "#1e2227",
  ios: {
    bundleIdentifier: "com.jellyfusion.app",
    supportsTablet: true,
    requireFullScreen: false,
    appleTeamId: "39TMVBW2CY",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ["audio"],
      NSLocalNetworkUsageDescription:
        "Jellyfuse uses your local network to discover and connect to Jellyfin servers running on your LAN.",
      "UISupportedInterfaceOrientations~ipad": [
        "UIInterfaceOrientationPortrait",
        "UIInterfaceOrientationPortraitUpsideDown",
        "UIInterfaceOrientationLandscapeLeft",
        "UIInterfaceOrientationLandscapeRight",
      ],
      ...(isProduction
        ? {
            NSBonjourServices: [],
            CFBundleURLTypes: [
              {
                CFBundleURLSchemes: ["jellyfuse", "com.jellyfusion.app"],
              },
            ],
          }
        : {}),
    },
  },
  android: {
    package: "com.jellyfusion.app",
    adaptiveIcon: {
      backgroundColor: "#1e2227",
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
    "expo-localization",
    "expo-router",
    [
      "expo-secure-store",
      {
        // No flow uses biometric-gated SecureStore, so we drop the Face ID
        // usage description rather than ship a placeholder reviewers can flag.
        faceIDPermission: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#1e2227",
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
      },
    ],
    [
      "expo-font",
      {
        fonts: ["./assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf"],
      },
    ],
    "@jellyfuse/downloader",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
  updates: {
    url: `https://u.expo.dev/${process.env.EAS_PROJECT_ID}`,
  },
  runtimeVersion: {
    policy: "appVersion",
  },
});
