/**
 * @file migration.types.ts
 * @description Type definitions for the migration system.
 *
 * These types define the public API that developers interact with when
 * writing migrations. The MigrationBuilder interface provides full
 * type-safe operations for all DDL (Data Definition Language) statements.
 */

import type { DatabaseSchema, TableName, ColumnName, TableIndex } from "./table.types.js";
import type { ColumnDefinition } from "./column.types.js";

// ============================================================
//  Core Migration Interface
// ============================================================

/**
 * The structure of a single migration file.
 *
 * Every migration file must export an object (or default export) implementing
 * this interface. The `up` function runs when migrating forward; `down` runs
 * when rolling back.
 *
 * @example
 * // migrations/20241215120000_create_users.ts
 * import type { Migration } from "db-migrate-ts";
 *
 * export default {
 *   name: "20241215120000_create_users",
 *   timestamp: 20241215120000,
 *   up: async (migrate) => {
 *     migrate.createTable("users", { ... });
 *   },
 *   down: async (migrate) => {
 *     migrate.dropTable("users");
 *   },
 * } satisfies Migration;
 */
export interface Migration<TDb extends DatabaseSchema = DatabaseSchema> {
  /**
   * A unique identifier for this migration.
   * Convention: `{YYYYMMDDHHMMSS}_{snake_case_description}`
   * @example "20241215120000_create_users_table"
   */
  name: string;

  /**
   * A numeric timestamp used to order migrations.
   * Use the same value as in the filename: YYYYMMDDHHMMSS as a number.
   * @example 20241215120000
   */
  timestamp: number;

  /**
   * The "up" migration — applies the schema changes.
   * Receives a MigrationBuilder instance for fluent DDL operations.
   */
  up: (migrate: MigrationBuilder<TDb>) => Promise<void> | void;

  /**
   * The "down" migration — reverses the schema changes (for rollback).
   * Should be the exact inverse of `up`.
   */
  down: (migrate: MigrationBuilder<TDb>) => Promise<void> | void;

  /**
   * Optional human-readable description of what this migration does.
   */
  description?: string;
}

// ============================================================
//  Migration Builder API
// ============================================================

/**
 * The fluent builder API for writing type-safe DDL operations inside migrations.
 *
 * All methods return `this` for chaining. Table names and column names are
 * validated against the DatabaseSchema type parameter at compile time —
 * typos cause TypeScript errors, not runtime failures.
 *
 * @template TDb - The full database schema type, used for type-checking names
 *
 * @example
 * // With schema type → full type safety
 * up: (migrate: MigrationBuilder<MyDB>) => {
 *   migrate.renameColumn("users", "username", "display_name");
 *   //                            ^^^^^^^^  ← TypeScript validates this!
 * }
 *
 * @example
 * // Without schema type → still works, just less type-safe
 * up: (migrate: MigrationBuilder) => {
 *   migrate.createTable("users", { ... });
 * }
 */
export interface MigrationBuilder<TDb extends DatabaseSchema = DatabaseSchema> {
  // ----------------------------------------------------------
  //  Table Operations
  // ----------------------------------------------------------

  /**
   * Creates a new database table with the given column schema.
   *
   * @param tableName - Name of the new table
   * @param schema    - Column definitions map
   *
   * @example
   * migrate.createTable("users", {
   *   id:    { schema: z.string().uuid(), primaryKey: true },
   *   email: { schema: z.string().email(), unique: true },
   *   name:  { schema: z.string().max(100) },
   * });
   */
  createTable<TSchema extends Record<string, ColumnDefinition>>(
    tableName: string,
    schema: TSchema
  ): this;

  /**
   * Drops (deletes) a table. Type-safe: table name must exist in the schema.
   *
   * @param tableName - The table to drop
   * @param options   - Optional CASCADE or RESTRICT behavior
   */
  dropTable<TName extends TableName<TDb>>(
    tableName: TName,
    options?: DropTableOptions
  ): this;

  /**
   * Renames a table. The `from` name is type-checked against the schema.
   *
   * @param from - Current table name (must exist in schema)
   * @param to   - New table name
   */
  renameTable<TName extends TableName<TDb>>(from: TName, to: string): this;

  /**
   * Truncates all rows from a table without dropping its structure.
   * Use with extreme caution — irreversible without a backup!
   */
  truncateTable<TName extends TableName<TDb>>(tableName: TName): this;

  // ----------------------------------------------------------
  //  Column Operations
  // ----------------------------------------------------------

  /**
   * Adds a new column to an existing table.
   *
   * @param tableName  - Target table (type-safe)
   * @param columnName - Name for the new column
   * @param definition - Column definition (type, constraints, etc.)
   *
   * @example
   * migrate.addColumn("users", "age", {
   *   schema: z.number().int().min(0).max(150),
   *   nullable: true,
   * });
   */
  addColumn<TName extends TableName<TDb>>(
    tableName: TName,
    columnName: string,
    definition: ColumnDefinition
  ): this;

  /**
   * Drops a column from a table.
   * Both table name AND column name are type-checked against the schema.
   *
   * @example
   * // ✅ TypeScript allows this — "age" exists in "users"
   * migrate.dropColumn("users", "age");
   *
   * // ❌ TypeScript error — "usr_age" doesn't exist in "users"
   * migrate.dropColumn("users", "usr_age");
   */
  dropColumn<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(
    tableName: TName,
    columnName: TCol
  ): this;

  /**
   * Renames a column. The original column name is type-safe.
   *
   * @example
   * // ✅ "username" is a valid column of "users"
   * migrate.renameColumn("users", "username", "display_name");
   *
   * // ❌ TypeScript error — "usr_name" is not a column of "users"
   * migrate.renameColumn("users", "usr_name", "display_name");
   */
  renameColumn<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(
    tableName: TName,
    from: TCol,
    to: string
  ): this;

  /**
   * Modifies a column's definition (type, constraints, nullability, etc.).
   * Uses ALTER COLUMN (PostgreSQL/MySQL) or recreates the column (SQLite).
   */
  alterColumn<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(
    tableName: TName,
    columnName: TCol,
    newDefinition: ColumnDefinition
  ): this;

  /**
   * Sets a column as NOT NULL (without changing its type).
   * Equivalent to alterColumn with nullable: false.
   */
  setNotNull<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(
    tableName: TName,
    columnName: TCol
  ): this;

  /**
   * Removes the NOT NULL constraint from a column (makes it nullable).
   */
  dropNotNull<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(
    tableName: TName,
    columnName: TCol
  ): this;

  /**
   * Sets or changes the default value of a column.
   */
  setDefault<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(
    tableName: TName,
    columnName: TCol,
    defaultValue: unknown
  ): this;

  /**
   * Removes the default value from a column.
   */
  dropDefault<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(
    tableName: TName,
    columnName: TCol
  ): this;

  // ----------------------------------------------------------
  //  Index Operations
  // ----------------------------------------------------------

  /**
   * Creates an index on one or more columns of a table.
   *
   * @example
   * // Simple index
   * migrate.createIndex("users", ["email"], { unique: true });
   *
   * // Composite index with custom name
   * migrate.createIndex("posts", ["author_id", "created_at"], {
   *   name: "idx_posts_author_date",
   * });
   *
   * // Partial index (PostgreSQL)
   * migrate.createIndex("orders", ["status"], {
   *   where: "status != 'completed'",
   *   name: "idx_orders_active_status",
   * });
   */
  createIndex<TName extends TableName<TDb>>(
    tableName: TName,
    columns: ColumnName<TDb, TName>[],
    options?: IndexOptions
  ): this;

  /**
   * Drops an index by its name.
   *
   * @param indexName - The name of the index to drop
   * @param options   - Optional CASCADE, IF EXISTS behavior
   */
  dropIndex(indexName: string, options?: DropIndexOptions): this;

  // ----------------------------------------------------------
  //  Constraint Operations
  // ----------------------------------------------------------

  /**
   * Adds a foreign key constraint to an existing column.
   */
  addForeignKey<TName extends TableName<TDb>>(
    tableName: TName,
    columnName: string,
    references: ForeignKeyConstraint
  ): this;

  /**
   * Drops a named foreign key constraint.
   */
  dropForeignKey<TName extends TableName<TDb>>(
    tableName: TName,
    constraintName: string
  ): this;

  /**
   * Adds a CHECK constraint to a table.
   */
  addCheck<TName extends TableName<TDb>>(
    tableName: TName,
    constraintName: string,
    expression: string
  ): this;

  /**
   * Drops a named CHECK constraint.
   */
  dropCheck<TName extends TableName<TDb>>(
    tableName: TName,
    constraintName: string
  ): this;

  // ----------------------------------------------------------
  //  Raw SQL Escape Hatch
  // ----------------------------------------------------------

  /**
   * Executes a raw SQL statement.
   * Use this for complex operations not covered by the builder API.
   * Note: Raw SQL statements are NOT type-checked.
   *
   * @param sql      - Raw SQL string
   * @param bindings - Optional parameterized values (prevents SQL injection)
   *
   * @example
   * // Create a PostgreSQL-specific extension
   * migrate.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
   *
   * // PostgreSQL enum type
   * migrate.raw('CREATE TYPE user_role AS ENUM (\'admin\', \'user\', \'moderator\')');
   *
   * // Complex UPDATE with parameterized values
   * migrate.raw("UPDATE users SET role = $1 WHERE email LIKE $2", ["admin", "%@company.com"]);
   */
  raw(sql: string, bindings?: unknown[]): this;
}

// ============================================================
//  Operation Options
// ============================================================

/** Options for DROP TABLE operations */
export interface DropTableOptions {
  /** Add IF EXISTS clause — no error if table doesn't exist */
  ifExists?: boolean;
  /** Add CASCADE — drops dependent objects (views, foreign keys, etc.) */
  cascade?: boolean;
}

/** Options for CREATE INDEX operations */
export interface IndexOptions {
  /** Custom index name (auto-generated from table+columns if omitted) */
  name?: string;
  /** Create a UNIQUE index */
  unique?: boolean;
  /** Partial index condition (SQL WHERE expression) */
  where?: string;
  /** Index algorithm (PostgreSQL only) */
  using?: "btree" | "hash" | "gin" | "gist" | "brin" | "spgist";
  /** Whether to create concurrently (PostgreSQL only — non-blocking) */
  concurrently?: boolean;
}

/** Options for DROP INDEX operations */
export interface DropIndexOptions {
  /** Add IF EXISTS clause */
  ifExists?: boolean;
  /** Add CASCADE */
  cascade?: boolean;
  /** Drop concurrently (PostgreSQL only) */
  concurrently?: boolean;
}

/** Foreign key constraint definition for addForeignKey */
export interface ForeignKeyConstraint {
  /** Referenced table */
  table: string;
  /** Referenced column */
  column: string;
  /** Optional constraint name */
  name?: string;
  /** On delete action */
  onDelete?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
  /** On update action */
  onUpdate?: "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION";
}

// ============================================================
//  Migration Status & Tracking
// ============================================================

/**
 * A record of an executed migration, stored in the migrations history table.
 */
export interface MigrationRecord {
  /** Auto-increment ID */
  id: number;
  /** Migration name (matches Migration.name) */
  name: string;
  /** Numeric timestamp from the migration file */
  timestamp: number;
  /** When this migration was executed */
  executedAt: Date;
  /** SHA-256 checksum of up+down functions for tamper detection */
  checksum: string;
  /** Execution duration in milliseconds */
  durationMs?: number;
}

/**
 * Current status of a migration in the system.
 */
export type MigrationStatus = "pending" | "executed" | "failed" | "skipped";

/**
 * Full migration status for display in CLI status command.
 */
export interface MigrationStatusEntry {
  name: string;
  timestamp: number;
  status: MigrationStatus;
  executedAt?: Date;
  durationMs?: number;
  checksumValid?: boolean;
}

// ============================================================
//  Dialect Types
// ============================================================

/**
 * Supported database dialects.
 */
export type Dialect = "postgres" | "mysql" | "sqlite";

/**
 * Options passed when creating the migration runner.
 */
export interface MigrationRunnerOptions {
  /** Database dialect */
  dialect: Dialect;
  /** Custom name for the migrations tracking table */
  migrationsTable?: string;
  /** Whether to validate checksums of previously-executed migrations */
  validateChecksums?: boolean;
  /** Whether to save generated SQL to snapshot files */
  saveSQLSnapshots?: boolean;
  /** Directory for SQL snapshots */
  snapshotsDir?: string;
  /** Dry run mode — compiles SQL but doesn't execute */
  dryRun?: boolean;
  /** Logger function (defaults to console.log) */
  logger?: (message: string) => void;
}

// ============================================================
//  Internal Operation Types (used by MigrationBuilderImpl)
// ============================================================

/**
 * Internal representation of a single DDL operation.
 * The builder collects these and compiles them to SQL at execution time.
 */
export type MigrationOperation =
  | { type: "CREATE_TABLE"; tableName: string; schema: Record<string, ColumnDefinition> }
  | { type: "DROP_TABLE"; tableName: string; options?: DropTableOptions }
  | { type: "RENAME_TABLE"; from: string; to: string }
  | { type: "TRUNCATE_TABLE"; tableName: string }
  | { type: "ADD_COLUMN"; tableName: string; columnName: string; definition: ColumnDefinition }
  | { type: "DROP_COLUMN"; tableName: string; columnName: string }
  | { type: "RENAME_COLUMN"; tableName: string; from: string; to: string }
  | {
      type: "ALTER_COLUMN";
      tableName: string;
      columnName: string;
      newDefinition: ColumnDefinition;
    }
  | { type: "SET_NOT_NULL"; tableName: string; columnName: string }
  | { type: "DROP_NOT_NULL"; tableName: string; columnName: string }
  | { type: "SET_DEFAULT"; tableName: string; columnName: string; defaultValue: unknown }
  | { type: "DROP_DEFAULT"; tableName: string; columnName: string }
  | { type: "CREATE_INDEX"; tableName: string; columns: string[]; options?: IndexOptions }
  | { type: "DROP_INDEX"; indexName: string; options?: DropIndexOptions }
  | {
      type: "ADD_FOREIGN_KEY";
      tableName: string;
      columnName: string;
      references: ForeignKeyConstraint;
    }
  | { type: "DROP_FOREIGN_KEY"; tableName: string; constraintName: string }
  | { type: "ADD_CHECK"; tableName: string; constraintName: string; expression: string }
  | { type: "DROP_CHECK"; tableName: string; constraintName: string }
  | { type: "RAW_SQL"; sql: string; bindings?: unknown[] };
