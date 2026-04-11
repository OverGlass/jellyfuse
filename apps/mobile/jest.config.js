/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
  // jest-expo's transformIgnorePatterns already covers the usual RN packages;
  // we extend it here for the extras we use (nitro, mmkv, flash-list, tanstack).
  transformIgnorePatterns: [
    "node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native|@react-navigation|expo(nent)?|@expo(nent)?/.*|expo-modules-core|@shopify/flash-list|@tanstack/.*|react-native-nitro-modules|react-native-nitro-fetch|react-native-mmkv|react-native-css-interop|@jellyfuse/.*))",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // React Compiler turns regular components into memoized render trees that
  // the @testing-library/react-native renderer handles fine; no extra setup
  // beyond the default jest-expo preset is needed for Phase 0b.4.
};
