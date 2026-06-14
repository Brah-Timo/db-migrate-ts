/**
 * @file config-loader.ts
 * @description Loads and validates the db-migrate.config.ts/js file.
 *
 * The CLI looks for a config file at the provided path (or default location)
 * and dynamically imports it to retrieve the migration configuration.
 */

import { resolve, extname } from "path";
import { stat } from "fs/promises";
import type { DatabaseSchema } from "db-migrate-ts";
import type { DatabaseAdapter } from "db-migrate-ts";
import type { Dialect, MigrationRunnerOptions } from "db-migrate-ts";

// ============================================================
//  Config Type
// ============================================================

/**
 * The shape of the user's db-migrate.config.ts file.
 *
 * @example
 * // db-migrate.config.ts
 * import { defineConfig } from "db-migrate-ts";
 * import { Pool } from "pg";
 *
 * export default defineConfig({
 *   adapter: "postgres",
 *   connection: new Pool({ connectionString: process.env.DATABASE_URL }),
 *   migrationsDir: "./migrations",
 *   schema: { ... },
 * });
 */
export interface MigrationConfig {
  /** The database dialect */
  adapter: Dialect;
  /** A configured database adapter instance */
  connection: DatabaseAdapter;
  /** Path to the migrations directory */
  migrationsDir: string;
  /** Optional schema definition for type-safe migrations */
  schema?: DatabaseSchema;
  /** Additional runner options */
  options?: Partial<MigrationRunnerOptions>;
}

// ============================================================
//  Config Loader
// ============================================================

/** Default config file names to search for */
const CONFIG_FILENAMES = [
  "db-migrate.config.ts",
  "db-migrate.config.js",
  "db-migrate.config.mjs",
  "db-migrate.config.cjs",
];

/**
 * Loads a migration config from a file path.
 *
 * @param configPath - Explicit path, or a directory to search in
 * @returns The loaded MigrationConfig
 * @throws If no config file is found or the config is invalid
 */
export async function loadConfig(configPath?: string): Promise<MigrationConfig> {
  const resolvedPath = await resolveConfigPath(configPath ?? process.cwd());

  let module: unknown;
  try {
    // We use a dynamic import — TypeScript files require ts-node/tsx in runtime
    module = await import(/* @vite-ignore */ resolvedPath);
  } catch (error) {
    const ext = extname(resolvedPath);
    const hint =
      ext === ".ts"
        ? `\nTo use TypeScript config files, run with: npx tsx $(which db-migrate-ts) ...` +
          `\nor install tsx: npm install -D tsx`
        : "";

    throw new Error(
      `[db-migrate-ts] Failed to load config from "${resolvedPath}": ` +
        `${error instanceof Error ? error.message : String(error)}${hint}`
    );
  }

  const config =
    (module as { default?: MigrationConfig }).default ??
    (module as MigrationConfig);

  validateConfig(config, resolvedPath);
  return config;
}

/**
 * Resolves the path to the config file.
 * If given a directory, searches for known config file names.
 * If given a file path, validates it exists.
 */
async function resolveConfigPath(pathOrDir: string): Promise<string> {
  const absolute = resolve(pathOrDir);

  // If it's an explicit file path
  try {
    const stats = await stat(absolute);
    if (stats.isFile()) {
      return absolute;
    }
  } catch {
    // Not a file — try as directory
  }

  // Search for config file in the directory
  const searchDir = absolute;
  for (const filename of CONFIG_FILENAMES) {
    const candidate = resolve(searchDir, filename);
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Not found — try next
    }
  }

  throw new Error(
    `[db-migrate-ts] No config file found.\n` +
      `Searched in: ${searchDir}\n` +
      `Expected one of: ${CONFIG_FILENAMES.join(", ")}\n\n` +
      `Create a config file:\n` +
      `  db-migrate-ts init   # generates db-migrate.config.ts`
  );
}

/**
 * Validates the loaded config object has required fields.
 */
function validateConfig(config: unknown, filePath: string): void {
  if (!config || typeof config !== "object") {
    throw new Error(
      `[db-migrate-ts] Config file "${filePath}" must export a configuration object.`
    );
  }

  const c = config as Record<string, unknown>;

  if (!c["adapter"]) {
    throw new Error(
      `[db-migrate-ts] Config is missing "adapter" field. ` +
        `Expected: "postgres", "mysql", or "sqlite".`
    );
  }

  if (!c["connection"]) {
    throw new Error(
      `[db-migrate-ts] Config is missing "connection" field. ` +
        `Provide a configured DatabaseAdapter instance.`
    );
  }

  if (!c["migrationsDir"]) {
    throw new Error(
      `[db-migrate-ts] Config is missing "migrationsDir" field. ` +
        `Example: migrationsDir: "./migrations"`
    );
  }
}
