/**
 * @file types/index.ts
 * @description Re-exports all type definitions from the types layer.
 */

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
} from "./column.types.js";

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
} from "./table.types.js";

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
} from "./migration.types.js";

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
} from "./dialect.types.js";

export { DIALECT_FEATURES } from "./dialect.types.js";
