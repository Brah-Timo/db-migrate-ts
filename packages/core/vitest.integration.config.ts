import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "integration",
    include: ["tests/integration/**/*.test.ts"],
    globals: true,
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ["verbose"],
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
    // Integration tests run sequentially to avoid DB conflicts
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
