import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["cjs"],
  dts: false,
  sourcemap: true,
  clean: true,
  target: "node18",
  platform: "node",
  external: ["db-migrate-ts", "pg", "mysql2", "better-sqlite3"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
