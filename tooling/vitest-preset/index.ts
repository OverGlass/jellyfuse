import { defineConfig } from "vitest/config"

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
})

export default baseConfig
