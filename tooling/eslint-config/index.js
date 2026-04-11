// Shared flat ESLint config for Jellyfuse.
// Kept minimal in Phase 0a; Phase 0b will add @typescript-eslint, eslint-plugin-react,
// eslint-plugin-react-compiler, and eslint-plugin-react-native once apps/mobile is installed.
export default [
  {
    ignores: ["**/dist/**", "**/build/**", "**/.expo/**", "**/ios/**", "**/android/**"],
  },
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
    },
  },
];
