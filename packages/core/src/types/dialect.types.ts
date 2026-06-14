/**
 * @file dialect.types.ts
 * @description Type definitions for database dialect-specific behavior.
 *
 * Each supported database (PostgreSQL, MySQL, SQLite) has different SQL syntax
 * for common operations. These types define the contracts that dialect
 * implementations must fulfill.
 */

import type { Dialect } from "./migration.types.js";
import type { ColumnDefinition } from "./column.types.js";
import type { IndexOptions, DropTableOptions, DropIndexOptions } from "./migration.types.js";

// ============================================================
//  Database Adapter Interface
// ============================================================

/**
 * The core interface every database adapter must implement.
 * Adapters wrap a specific database driver (pg, mysql2, better-sqlite3)
 * and expose a uniform API to the migration runner.
 *
 * @example
 * // Usage with PostgreSQL
 * const { Pool } = require("pg");
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const adapter = new PostgresAdapter(pool);
 * const runner = new MigrationRunner(adapter, "postgres");
 */
export interface DatabaseAdapter {
  /**
   * The dialect identifier for this adapter.
   * Used by the SQL builder to generate dialect-specific SQL.
   */
  readonly dialect: Dialect;

  /**
   * Executes a DDL or DML statement that doesn't return rows.
   *
   * @param sql    - The SQL statement to execute
   * @param params - Parameterized values for prepared statements
   */
  execute(sql: string, params?: unknown[]): Promise<void>;

  /**
   * Executes a SELECT query and returns the result rows.
   *
   * @template T   - The expected shape of each row
   * @param sql    - The SQL SELECT query
   * @param params - Parameterized values for prepared statements
   * @returns Array of rows matching type T
   */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /**
   * Runs a set of operations inside a database transaction.
   * If `fn` throws, the transaction is automatically rolled back.
   * If `fn` succeeds, the transaction is automatically committed.
   *
   * @template T - Return type of the transactional function
   * @param fn  - Async function containing the operations to run atomically
   * @returns The value returned by fn
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /**
   * Closes the database connection/pool.
   * Should be called when the migration process is complete.
   */
  close(): Promise<void>;

  /**
   * Checks if the adapter's connection is healthy.
   * Useful for pre-flight checks before running migrations.
   */
  ping?(): Promise<boolean>;

  /**
   * Returns the database server version string.
   * Used for dialect-specific feature detection.
   */
  getVersion?(): Promise<string>;
}

// ============================================================
//  SQL Dialect Interface
// ============================================================

/**
 * The interface for dialect-specific SQL generation.
 * Each supported database implements this to produce correct SQL syntax.
 */
export interface SqlDialect {
  readonly name: Dialect;

  // Table DDL
  createTableSQL(
    tableName: string,
    schema: Record<string, ColumnDefinition>,
    converter: ColumnTypeConverter
  ): string;

  dropTableSQL(tableName: string, options?: DropTableOptions): string;
  renameTableSQL(from: string, to: string): string;
  truncateTableSQL(tableName: string): string;

  // Column DDL
  addColumnSQL(
    tableName: string,
    columnName: string,
    definition: ColumnDefinition,
    converter: ColumnTypeConverter
  ): string;

  dropColumnSQL(tableName: string, columnName: string): string;
  renameColumnSQL(tableName: string, from: string, to: string): string;
  alterColumnSQL(
    tableName: string,
    columnName: string,
    newDefinition: ColumnDefinition,
    converter: ColumnTypeConverter
  ): string;

  setNotNullSQL(tableName: string, columnName: string): string;
  dropNotNullSQL(tableName: string, columnName: string): string;
  setDefaultSQL(tableName: string, columnName: string, defaultValue: unknown): string;
  dropDefaultSQL(tableName: string, columnName: string): string;

  // Index DDL
  createIndexSQL(tableName: string, columns: string[], options?: IndexOptions): string;
  dropIndexSQL(indexName: string, options?: DropIndexOptions): string;

  // Constraint DDL
  addForeignKeySQL(
    tableName: string,
    columnName: string,
    references: {
      table: string;
      column: string;
      name?: string;
      onDelete?: string;
      onUpdate?: string;
    }
  ): string;

  dropForeignKeySQL(tableName: string, constraintName: string): string;
  addCheckSQL(tableName: string, constraintName: string, expression: string): string;
  dropCheckSQL(tableName: string, constraintName: string): string;

  // Utility
  quoteIdentifier(name: string): string;
  formatDefaultValue(value: unknown): string;
}

// ============================================================
//  Column Type Converter Interface
// ============================================================

/**
 * Converts a ColumnDefinition to a SQL type string for a specific dialect.
 */
export interface ColumnTypeConverter {
  /**
   * Returns the full SQL column definition string including type and constraints.
   *
   * @example
   * converter.convert({ schema: z.string().max(100), unique: true })
   * // PostgreSQL → "VARCHAR(100) NOT NULL UNIQUE"
   * // SQLite     → "TEXT NOT NULL UNIQUE"
   */
  convert(definition: ColumnDefinition): string;

  /**
   * Returns only the base SQL type (without constraints).
   *
   * @example
   * converter.getBaseType({ schema: z.number().int() })
   * // PostgreSQL → "INTEGER"
   * // MySQL      → "INT"
   * // SQLite     → "INTEGER"
   */
  getBaseType(definition: ColumnDefinition): string;
}

// ============================================================
//  Connection Configuration Types
// ============================================================

/** PostgreSQL connection configuration */
export interface PostgresConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  connectionString?: string;
  ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string };
  poolMin?: number;
  poolMax?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
}

/** MySQL connection configuration */
export interface MySQLConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  uri?: string;
  ssl?: { ca?: string; cert?: string; key?: string };
  connectionLimit?: number;
  waitForConnections?: boolean;
}

/** SQLite connection configuration */
export interface SQLiteConfig {
  /** Path to the SQLite database file. Use ":memory:" for in-memory databases. */
  filename: string;
  /** Open in read-only mode */
  readonly?: boolean;
  /** File must already exist */
  fileMustExist?: boolean;
  /** Transaction timeout in milliseconds */
  timeout?: number;
  /** Enable WAL mode for better concurrent read performance */
  wal?: boolean;
}

/** Union of all connection configurations */
export type ConnectionConfig = PostgresConfig | MySQLConfig | SQLiteConfig;

// ============================================================
//  Dialect Feature Matrix
// ============================================================

/**
 * Describes which SQL features are supported by a given dialect.
 * Used for feature-detection before generating advanced SQL.
 */
export interface DialectFeatures {
  /** Supports JSONB column type */
  jsonb: boolean;
  /** Supports native UUID type */
  uuid: boolean;
  /** Supports ENUM types */
  enumTypes: boolean;
  /** Supports partial indexes (WHERE clause on indexes) */
  partialIndexes: boolean;
  /** Supports CONCURRENT index creation */
  concurrentIndexes: boolean;
  /** Supports RETURNING clause on INSERT/UPDATE/DELETE */
  returning: boolean;
  /** Supports generated columns */
  generatedColumns: boolean;
  /** Supports schema namespaces */
  schemas: boolean;
  /** Supports advisory locks */
  advisoryLocks: boolean;
  /** Supports column comments */
  columnComments: boolean;
  /** Supports multiple schemas/databases */
  multipleSchemas: boolean;
  /** ALTER TABLE RENAME COLUMN syntax */
  renameColumn: boolean;
  /** DROP COLUMN syntax */
  dropColumn: boolean;
  /** ALTER COLUMN type change */
  alterColumnType: boolean;
}

/** Feature matrix for each supported dialect */
export const DIALECT_FEATURES: Record<Dialect, DialectFeatures> = {
  postgres: {
    jsonb: true,
    uuid: true,
    enumTypes: true,
    partialIndexes: true,
    concurrentIndexes: true,
    returning: true,
    generatedColumns: true,
    schemas: true,
    advisoryLocks: true,
    columnComments: true,
    multipleSchemas: true,
    renameColumn: true,
    dropColumn: true,
    alterColumnType: true,
  },
  mysql: {
    jsonb: false,
    uuid: false,
    enumTypes: true,
    partialIndexes: false,
    concurrentIndexes: false,
    returning: false,
    generatedColumns: true,
    schemas: false,
    advisoryLocks: true,
    columnComments: true,
    multipleSchemas: false,
    renameColumn: true,
    dropColumn: true,
    alterColumnType: true,
  },
  sqlite: {
    jsonb: false,
    uuid: false,
    enumTypes: false,
    partialIndexes: true,
    concurrentIndexes: false,
    returning: true, // SQLite >= 3.35.0
    generatedColumns: true, // SQLite >= 3.31.0
    schemas: false,
    advisoryLocks: false,
    columnComments: false,
    multipleSchemas: false,
    renameColumn: true, // SQLite >= 3.25.0
    dropColumn: true, // SQLite >= 3.35.0
    alterColumnType: false, // SQLite doesn't support ALTER COLUMN TYPE
  },
};
