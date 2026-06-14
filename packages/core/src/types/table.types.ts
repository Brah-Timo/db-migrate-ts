/**
 * @file table.types.ts
 * @description Table-level type definitions that compose column types into full schemas.
 *
 * These types form the "schema registry" concept — once you define your database
 * schema as a TypeScript object, every migration operation gains full type safety
 * for table names, column names, and value types.
 */

import type { z } from "zod";
import type {
  ColumnDefinition,
  InferColumn,
  IsNullableColumn,
  RequiredColumns,
  OptionalColumns,
} from "./column.types.js";

// ============================================================
//  Table & Database Schema Definitions
// ============================================================

/**
 * A table schema: a record mapping column names to their ColumnDefinition.
 *
 * @example
 * const usersSchema = {
 *   id:    { schema: z.string().uuid(), primaryKey: true },
 *   email: { schema: z.string().email(), unique: true },
 *   name:  { schema: z.string().max(100) },
 * } satisfies TableSchema;
 */
export type TableSchema = Record<string, ColumnDefinition>;

/**
 * The full database schema: a record mapping table names to their TableSchema.
 *
 * This is the root-level type. Once defined, it powers all type-safe operations
 * throughout the migration system.
 *
 * @example
 * const myDatabase = {
 *   users: { id: { schema: z.string().uuid(), primaryKey: true }, ... },
 *   posts: { id: { schema: z.number().int(), primaryKey: true }, ... },
 * } satisfies DatabaseSchema;
 */
export type DatabaseSchema = Record<string, TableSchema>;

// ============================================================
//  Name Extraction Types
// ============================================================

/**
 * Extracts all table names from a DatabaseSchema as a union type.
 * This is the key to type-safe table name parameters.
 *
 * @example
 * type MyDB = { users: {...}; posts: {...}; comments: {...} }
 * type Tables = TableName<MyDB>  // "users" | "posts" | "comments"
 *
 * // TypeScript ERROR: "usrs" is not assignable to TableName<MyDB>
 * function getTable(name: TableName<MyDB>) { ... }
 * getTable("usrs"); // ❌ Compile-time error!
 * getTable("users"); // ✅ OK
 */
export type TableName<TDb extends DatabaseSchema> = keyof TDb & string;

/**
 * Extracts all column names for a specific table from a DatabaseSchema.
 *
 * @example
 * type MyDB = { users: { id: ...; email: ...; name: ... } }
 * type UserCols = ColumnName<MyDB, "users">  // "id" | "email" | "name"
 *
 * // TypeScript ERROR: "usr_email" is not assignable to ColumnName<MyDB, "users">
 */
export type ColumnName<
  TDb extends DatabaseSchema,
  TTable extends TableName<TDb>,
> = keyof TDb[TTable] & string;

/**
 * Extracts the ColumnDefinition type for a specific column in a specific table.
 */
export type ColumnDef<
  TDb extends DatabaseSchema,
  TTable extends TableName<TDb>,
  TCol extends ColumnName<TDb, TTable>,
> = TDb[TTable][TCol];

// ============================================================
//  Type Inference — Schema → TypeScript Interface
// ============================================================

/**
 * Converts a TableSchema into a full TypeScript interface for that table's rows.
 *
 * This is the "magic" type — it transforms your column definitions into
 * a strongly-typed row shape that TypeScript understands completely.
 *
 * @example
 * type UsersRow = InferTableType<typeof usersSchema>
 * // → { id: string; email: string; name: string; age?: number | undefined }
 */
export type InferTableType<T extends TableSchema> = {
  [K in keyof T]: InferColumn<T[K]>;
};

/**
 * Generates the TypeScript type for INSERT operations on a table.
 * Required columns must be provided; optional/defaulted columns can be omitted.
 *
 * @example
 * type InsertUser = InsertType<typeof usersSchema>
 * // → { email: string; name: string; id?: string; createdAt?: Date }
 */
export type InsertType<T extends TableSchema> = {
  [K in keyof RequiredColumns<T>]: InferColumn<T[K]>;
} & {
  [K in keyof OptionalColumns<T>]?: InferColumn<T[K]>;
};

/**
 * Generates the TypeScript type for UPDATE operations on a table.
 * All columns are optional since updates are partial.
 */
export type UpdateType<T extends TableSchema> = {
  [K in keyof T]?: InferColumn<T[K]>;
};

/**
 * The SELECT result type for a full table row.
 * Equivalent to InferTableType but named semantically.
 */
export type SelectType<T extends TableSchema> = InferTableType<T>;

/**
 * Extracts the primary key type from a TableSchema.
 *
 * @example
 * type UserPK = PrimaryKeyType<typeof usersSchema>  // string (UUID)
 * type PostPK = PrimaryKeyType<typeof postsSchema>  // number (integer)
 */
export type PrimaryKeyType<T extends TableSchema> = {
  [K in keyof T as T[K]["primaryKey"] extends true ? K : never]: InferColumn<T[K]>;
};

// ============================================================
//  Table Metadata
// ============================================================

/**
 * Supported index types for table indexes.
 */
export type IndexType = "btree" | "hash" | "gin" | "gist" | "brin" | "spgist";

/**
 * Metadata describing an index on a table.
 */
export interface TableIndex {
  /** Unique name for this index */
  name: string;
  /** Columns included in the index */
  columns: string[];
  /** Whether this is a UNIQUE index */
  unique?: boolean;
  /** Partial index — only indexes rows matching this condition */
  where?: string;
  /** Index algorithm (PostgreSQL-specific, defaults to btree) */
  using?: IndexType;
}

/**
 * Full metadata for a table, including its schema and additional configuration.
 */
export interface TableMeta<T extends TableSchema = TableSchema> {
  /** The column schema definitions */
  schema: T;
  /** Optional table-level comment */
  comment?: string;
  /** Explicit indexes (beyond auto-created column indexes) */
  indexes?: TableIndex[];
}

// ============================================================
//  Query Result Types
// ============================================================

/**
 * The result type of a SELECT query on a specific table.
 *
 * @example
 * const users = await db.query<QueryResult<MyDB, "users">>("SELECT * FROM users");
 * users[0].email; // ✅ TypeScript knows this is a string
 * users[0].age;   // ✅ TypeScript knows this is number | undefined
 */
export type QueryResult<
  TDb extends DatabaseSchema,
  TTable extends TableName<TDb>,
> = InferTableType<TDb[TTable]>;

/**
 * A partial result type for SELECT queries that only return specific columns.
 *
 * @example
 * type UserSummary = PartialQueryResult<MyDB, "users", "id" | "email">
 * // → { id: string; email: string }
 */
export type PartialQueryResult<
  TDb extends DatabaseSchema,
  TTable extends TableName<TDb>,
  TColumns extends ColumnName<TDb, TTable>,
> = {
  [K in TColumns]: InferColumn<TDb[TTable][K]>;
};

// ============================================================
//  Schema Diff Types
// ============================================================

/**
 * Represents a detected change between two versions of a schema.
 * Used by the schema-differ to auto-generate migrations.
 */
export type SchemaChange =
  | { kind: "CREATE_TABLE"; tableName: string; schema: TableSchema }
  | { kind: "DROP_TABLE"; tableName: string }
  | { kind: "ADD_COLUMN"; tableName: string; columnName: string; definition: ColumnDefinition }
  | { kind: "DROP_COLUMN"; tableName: string; columnName: string }
  | {
      kind: "ALTER_COLUMN";
      tableName: string;
      columnName: string;
      before: ColumnDefinition;
      after: ColumnDefinition;
    }
  | { kind: "RENAME_TABLE"; from: string; to: string }
  | { kind: "RENAME_COLUMN"; tableName: string; from: string; to: string }
  | { kind: "ADD_INDEX"; tableName: string; index: TableIndex }
  | { kind: "DROP_INDEX"; indexName: string };

/**
 * Result of comparing two database schemas.
 */
export interface SchemaDiff {
  /** All detected changes between old and new schema */
  changes: SchemaChange[];
  /** Tables added in the new schema */
  addedTables: string[];
  /** Tables removed from the old schema */
  removedTables: string[];
  /** Tables that exist in both schemas (may have column changes) */
  modifiedTables: string[];
  /** Whether any changes were detected at all */
  hasChanges: boolean;
}
