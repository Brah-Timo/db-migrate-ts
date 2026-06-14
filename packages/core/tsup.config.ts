import { defineConfig } from "tsup";

export default defineConfig([
  // Main bundle
  {
    entry: {
      index: "src/index.ts",
      "dialects/postgres.dialect": "src/dialects/postgres.dialect.ts",
      "dialects/mysql.dialect": "src/dialects/mysql.dialect.ts",
      "dialects/sqlite.dialect": "src/dialects/sqlite.dialect.ts",
    },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    minify: false,
    target: "node18",
    platform: "node",
    outDir: "dist",
    external: ["pg", "mysql2", "better-sqlite3", "zod"],
    banner: {
      js: `/**
 * db-migrate-ts v1.0.0
 * Type-safe database migrations powered by Zod and TypeScript
 * License: MIT — https://github.com/db-migrate-ts/db-migrate-ts
 */`,
    },
  },
]);
