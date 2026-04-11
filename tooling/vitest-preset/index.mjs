// @ts-check
import { defineConfig } from "vitest/config";

/**
 * Shared Vitest base config for pure-TS workspace packages.
 * Consumers import via the package name: `from '@jellyfuse/vitest-preset'`.
 * Authored as plain .mjs so Node's native ESM loader can handle it — vitest
 * loads configs through bundle-require/esbuild which marks node_modules as
 * external, so a .ts preset would choke the consumer's config loader.
 */
export const baseConfig = defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
    },
  },
});

export default baseConfig;
