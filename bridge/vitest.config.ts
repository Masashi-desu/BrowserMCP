import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["dist/**", "node_modules/**"],
    include: ["tests/**/*.test.ts"],
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
});
