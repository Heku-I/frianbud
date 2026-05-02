import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.live.test.ts", "tests/smoke/**"],
    globals: false,
    environment: "node",
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
    },
  },
});
