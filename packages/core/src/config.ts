/**
 * @file config.ts
 * @description The defineConfig helper for creating type-safe migration configurations.
 *
 * This is the primary entry point for users setting up db-migrate-ts in their project.
 * The defineConfig function provides type inference, validation, and a clean API
 * for specifying all migration options.
 *
 * @example
 * // db-migrate.config.ts
 * import { defineConfig } from "db-migrate-ts";
 * import { Pool } from "pg";
 * import { z } from "zod";
 *
 * export default defineConfig({
 *   adapter: "postgres",
 *   connection: new Pool({ connectionString: process.env.DATABASE_URL }),
 *   migrationsDir: "./migrations",
 *   schema: {
 *     users: {
 *       id:    { schema: z.string().uuid(), primaryKey: true },
 *       email: { schema: z.string().email(), unique: true },
 *       name:  { schema: z.string().max(100) },
 *     },
 *   },
 *   options: {
 *     validateChecksums: true,
 *     saveSQLSnapshots: false,
 *   },
 * });
 */

import type { Dialect, MigrationRunnerOptions } from "./types/migration.types.js";
import type { DatabaseAdapter } from "./types/dialect.types.js";
import type { DatabaseSchema } from "./types/table.types.js";
import { SchemaValidator } from "./schema/schema-validator.js";

// ============================================================
//  Config Interface
// ============================================================

/**
 * Full configuration object for db-migrate-ts.
 * Pass to defineConfig() in your db-migrate.config.ts file.
 */
export interface MigrationConfig<TDb extends DatabaseSchema = DatabaseSchema> {
  /**
   * The database dialect.
   * Determines SQL generation style and feature support.
   */
  adapter: Dialect;

  /**
   * A configured DatabaseAdapter instance.
   * Create using the adapter factory functions:
   *   - createPostgresAdapter(connectionString)
   *   - createMySQLAdapter(uri)
   *   - createSQLiteAdapter(filename)
   *
   * Or use the raw constructors:
   *   - new PostgresAdapter(pool)
   *   - new MySQLAdapter(pool)
   *   - new SQLiteAdapter(db)
   */
  connection: DatabaseAdapter;

  /**
   * Path to the directory containing migration files.
   * Can be relative (resolved from cwd) or absolute.
   *
   * @default "./migrations"
   */
  migrationsDir: string;

  /**
   * Optional schema definition for type-safe migration building.
   *
   * When provided, migration operations like dropColumn() and renameColumn()
   * will validate table/column names against this schema at compile time,
   * catching typos before they reach the database.
   *
   * @example
   * schema: {
   *   users: {
   *     id:    { schema: z.string().uuid(), primaryKey: true },
   *     email: { schema: z.string().email() },
   *   }
   * }
   */
  schema?: TDb;

  /**
   * Advanced runner options.
   */
  options?: Partial<
    Pick<
      MigrationRunnerOptions,
      | "migrationsTable"
      | "validateChecksums"
      | "saveSQLSnapshots"
      | "snapshotsDir"
    >
  >;
}

// ============================================================
//  defineConfig
// ============================================================

/**
 * Type-safe configuration factory for db-migrate-ts.
 *
 * Provides:
 * - TypeScript type inference for your schema
 * - Runtime validation of config fields
 * - Schema validation (if schema is provided)
 *
 * @example
 * export default defineConfig({
 *   adapter: "postgres",
 *   connection: new PostgresAdapter(pool),
 *   migrationsDir: "./migrations",
 *   schema: {
 *     users: { id: { schema: z.string().uuid(), primaryKey: true } }
 *   },
 * });
 */
export function defineConfig<TDb extends DatabaseSchema = DatabaseSchema>(
  config: MigrationConfig<TDb>
): MigrationConfig<TDb> {
  // Runtime validation
  if (!config.adapter) {
    throw new Error(
      '[db-migrate-ts] defineConfig: "adapter" is required. ' +
        'Expected: "postgres", "mysql", or "sqlite".'
    );
  }

  if (!["postgres", "mysql", "sqlite"].includes(config.adapter)) {
    throw new Error(
      `[db-migrate-ts] defineConfig: Unknown adapter "${config.adapter}". ` +
        'Expected: "postgres", "mysql", or "sqlite".'
    );
  }

  if (!config.connection) {
    throw new Error('[db-migrate-ts] defineConfig: "connection" is required.');
  }

  if (!config.migrationsDir) {
    throw new Error('[db-migrate-ts] defineConfig: "migrationsDir" is required.');
  }

  // Validate schema if provided
  if (config.schema) {
    const validator = new SchemaValidator();
    const result = validator.validate(config.schema as DatabaseSchema);

    // Print warnings but don't throw
    if (result.warnings.length > 0) {
      result.warnings.forEach((w) =>
        console.warn(`[db-migrate-ts] Schema warning: ${w}`)
      );
    }

    if (!result.valid) {
      const errorList = result.errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n");
      throw new Error(
        `[db-migrate-ts] defineConfig: Schema validation failed:\n${errorList}`
      );
    }
  }

  return config;
}
