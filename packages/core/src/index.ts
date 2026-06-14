/**
 * @file index.ts
 * @description Public API for db-migrate-ts.
 *
 * This is the main entry point. Import everything you need from "db-migrate-ts".
 *
 * @example
 * import {
 *   defineConfig,
 *   MigrationRunner,
 *   PostgresAdapter,
 *   SQLiteAdapter,
 * } from "db-migrate-ts";
 *
 * @example
 * import type { Migration, MigrationBuilder, DatabaseSchema } from "db-migrate-ts";
 */

// ============================================================
//  Configuration
// ============================================================

export { defineConfig } from "./config.js";
export type { MigrationConfig } from "./config.js";

// ============================================================
//  Migration Engine
// ============================================================

export { MigrationBuilderImpl } from "./migration/migration-builder.js";
export { MigrationRunner } from "./migration/migration-runner.js";
export { MigrationTracker, DEFAULT_MIGRATIONS_TABLE } from "./migration/migration-tracker.js";
export { RollbackManager } from "./migration/rollback-manager.js";

export type { MigrationRunnerResult } from "./migration/migration-runner.js";

// ============================================================
//  Database Adapters
// ============================================================

export { PostgresAdapter, createPostgresAdapter } from "./dialects/postgres.dialect.js";
export { MySQLAdapter, createMySQLAdapter } from "./dialects/mysql.dialect.js";
export { SQLiteAdapter, createSQLiteAdapter } from "./dialects/sqlite.dialect.js";
export { BaseDialectAdapter } from "./dialects/base.dialect.js";

// ============================================================
//  Schema Utilities
// ============================================================

export { SchemaRegistry, createRegistry } from "./schema/schema-registry.js";
export { SchemaDiffer, formatDiff } from "./schema/schema-differ.js";
export { SchemaValidator, validateSchema, validateSchemaOrThrow } from "./schema/schema-validator.js";
export { ZodToSQLConverter } from "./schema/zod-to-sql.js";

export type { ValidationResult } from "./schema/schema-validator.js";

// ============================================================
//  SQL Utilities
// ============================================================

export { SqlBuilder } from "./sql/sql-builder.js";
export { formatSQL, formatSQLFile, highlightSQL } from "./sql/sql-formatter.js";
export {
  validateIdentifier,
  validateIdentifiers,
  sanitizeLike,
  escapeString,
  detectSQLInjection,
  validateMigrationName,
} from "./sql/sql-sanitizer.js";

// ============================================================
//  File Loading Utilities
// ============================================================

export {
  discoverMigrationFiles,
  loadMigrationFile,
  loadAllMigrations,
  generateTimestamp,
  sanitizeMigrationName,
  MIGRATION_FILE_PATTERN,
} from "./utils/file-loader.js";

export type { MigrationFileInfo } from "./utils/file-loader.js";

// ============================================================
//  Error Classes
// ============================================================

export {
  MigrationError,
  MigrationLoadError,
  ChecksumMismatchError,
  MigrationExecutionError,
  MigrationsDirNotFoundError,
  DatabaseConnectionError,
  SchemaValidationError,
  UnsupportedDialectOperationError,
  EmptyTableSchemaError,
  InvalidRenameError,
} from "./utils/errors.js";

// ============================================================
//  Logging
// ============================================================

export { Logger, createLogger, defaultLogger } from "./utils/logger.js";
export type { LogLevel, LoggerOptions } from "./utils/logger.js";

// ============================================================
//  Types (all re-exported from types/)
// ============================================================

export type {
  // Column types
  ZodToSQLType,
  ReferentialAction,
  ForeignKeyRef,
  GenerationStrategy,
  CheckConstraint,
  ColumnDefinition,
  InferColumn,
  IsNullableColumn,
  PrimaryKeyColumns,
  RequiredColumns,
  OptionalColumns,
} from "./types/column.types.js";

export type {
  // Table types
  TableSchema,
  DatabaseSchema,
  TableName,
  ColumnName,
  ColumnDef,
  InferTableType,
  InsertType,
  UpdateType,
  SelectType,
  PrimaryKeyType,
  IndexType,
  TableIndex,
  TableMeta,
  QueryResult,
  PartialQueryResult,
  SchemaChange,
  SchemaDiff,
} from "./types/table.types.js";

export type {
  // Migration types
  Migration,
  MigrationBuilder,
  DropTableOptions,
  IndexOptions,
  DropIndexOptions,
  ForeignKeyConstraint,
  MigrationRecord,
  MigrationStatus,
  MigrationStatusEntry,
  Dialect,
  MigrationRunnerOptions,
  MigrationOperation,
} from "./types/migration.types.js";

export type {
  // Dialect types
  DatabaseAdapter,
  SqlDialect,
  ColumnTypeConverter,
  PostgresConfig,
  MySQLConfig,
  SQLiteConfig,
  ConnectionConfig,
  DialectFeatures,
} from "./types/dialect.types.js";

export { DIALECT_FEATURES } from "./types/dialect.types.js";

// ============================================================
//  Package version
// ============================================================

export const VERSION = "1.0.0" as const;
