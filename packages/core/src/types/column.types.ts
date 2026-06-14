/**
 * @file column.types.ts
 * @description Core column type definitions — the bridge between Zod schemas and SQL types.
 *
 * This is the most important file in the entire library. It defines the type system
 * that connects Zod validation schemas to actual SQL column definitions, providing
 * full TypeScript type safety at the schema-definition level.
 */

import type { z } from "zod";

// ============================================================
//  Zod → SQL Type Mapping
// ============================================================

/**
 * Compile-time mapping from a Zod schema type to its SQL column type string.
 *
 * This conditional type is evaluated entirely at compile time by TypeScript,
 * meaning that if you pass the wrong Zod type for a SQL type, you get a
 * TypeScript error — not a runtime crash.
 *
 * @example
 * type T1 = ZodToSQLType<z.ZodString>   // "TEXT" | "VARCHAR" | "CHAR"
 * type T2 = ZodToSQLType<z.ZodNumber>   // "INTEGER" | "BIGINT" | "FLOAT" | "DECIMAL" | "NUMERIC"
 * type T3 = ZodToSQLType<z.ZodBoolean>  // "BOOLEAN"
 */
export type ZodToSQLType<T extends z.ZodTypeAny> =
  T extends z.ZodString
    ? "TEXT" | "VARCHAR" | "CHAR" | "UUID" | "EMAIL"
    : T extends z.ZodNumber
    ? "INTEGER" | "BIGINT" | "FLOAT" | "DECIMAL" | "NUMERIC" | "DOUBLE PRECISION" | "REAL"
    : T extends z.ZodBoolean
    ? "BOOLEAN" | "TINYINT"
    : T extends z.ZodDate
    ? "TIMESTAMP" | "TIMESTAMPTZ" | "DATE" | "DATETIME" | "TIME"
    : T extends z.ZodBigInt
    ? "BIGINT"
    : T extends z.ZodEnum<infer _Values>
    ? "TEXT" | "VARCHAR"
    : T extends z.ZodNativeEnum<infer _EnumType>
    ? "TEXT" | "INTEGER"
    : T extends z.ZodArray<infer _ItemType>
    ? "JSON" | "JSONB" | "TEXT"
    : T extends z.ZodObject<infer _Shape>
    ? "JSON" | "JSONB"
    : T extends z.ZodRecord<infer _Key, infer _Value>
    ? "JSON" | "JSONB"
    : T extends z.ZodNullable<infer Inner>
    ? ZodToSQLType<Inner>
    : T extends z.ZodOptional<infer Inner>
    ? ZodToSQLType<Inner>
    : T extends z.ZodDefault<infer Inner>
    ? ZodToSQLType<Inner>
    : "TEXT"; // Safe fallback for any unrecognized Zod type

// ============================================================
//  Column Modifiers
// ============================================================

/**
 * Action to take when a referenced row is deleted/updated (for Foreign Keys).
 */
export type ReferentialAction = "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION" | "SET DEFAULT";

/**
 * Defines a foreign key relationship to another table.
 *
 * @example
 * const authorRef: ForeignKeyRef = {
 *   table: "users",
 *   column: "id",
 *   onDelete: "CASCADE",
 *   onUpdate: "RESTRICT",
 * };
 */
export interface ForeignKeyRef {
  /** The referenced table name */
  table: string;
  /** The referenced column name in the target table */
  column: string;
  /** Action when the referenced row is deleted */
  onDelete?: ReferentialAction;
  /** Action when the referenced column value changes */
  onUpdate?: ReferentialAction;
  /** Optional custom constraint name */
  constraintName?: string;
}

/**
 * Options for generating column values automatically.
 * Used for auto-increment or sequence-based primary keys.
 */
export type GenerationStrategy =
  | "autoincrement"      // Standard auto-increment (SQLite, MySQL)
  | "sequence"           // PostgreSQL SEQUENCE
  | "uuid"               // UUID v4 via gen_random_uuid() or uuid_generate_v4()
  | "cuid"               // CUID (application-level)
  | "nanoid";            // NanoID (application-level)

/**
 * Check constraint definition — enforces a condition on column values.
 *
 * @example
 * const ageCheck: CheckConstraint = {
 *   name: "chk_users_age_range",
 *   expression: "age >= 0 AND age <= 150",
 * };
 */
export interface CheckConstraint {
  /** Unique name for the constraint */
  name: string;
  /** SQL boolean expression evaluated against the column value */
  expression: string;
}

// ============================================================
//  Core Column Definition
// ============================================================

/**
 * Full column definition connecting a Zod schema to its SQL representation.
 *
 * This is the primary building block for table schemas in db-migrate-ts.
 * Every column in a table is described by one of these objects, and the
 * generic parameter `T` carries the Zod type so TypeScript can infer the
 * correct runtime value type.
 *
 * @template T - The Zod schema type for this column's values
 *
 * @example
 * // Simple required string column
 * const emailCol: ColumnDefinition<z.ZodString> = {
 *   schema: z.string().email().max(254),
 *   unique: true,
 *   index: true,
 * };
 *
 * @example
 * // Nullable integer with default
 * const ageCol: ColumnDefinition<z.ZodOptional<z.ZodNumber>> = {
 *   schema: z.number().int().min(0).max(150).optional(),
 *   nullable: true,
 *   default: null,
 * };
 *
 * @example
 * // Foreign key column
 * const authorIdCol: ColumnDefinition<z.ZodString> = {
 *   schema: z.string().uuid(),
 *   references: { table: "users", column: "id", onDelete: "CASCADE" },
 * };
 */
export interface ColumnDefinition<T extends z.ZodTypeAny = z.ZodTypeAny> {
  /**
   * The Zod schema that defines this column's type and validation rules.
   * The SQL type is automatically inferred from this schema at compile time.
   */
  schema: T;

  /**
   * Whether this column allows NULL values.
   * If not specified, inferred automatically:
   *   - `z.optional()` or `z.nullable()` → nullable = true
   *   - All other schemas → nullable = false (NOT NULL)
   */
  nullable?: boolean;

  /**
   * The default value for this column when no value is provided.
   * Must be assignable to `z.infer<T>` or a raw SQL expression string.
   *
   * @example
   * default: false                    // Boolean default
   * default: "guest"                  // String default
   * default: 0                        // Numeric default
   * default: "NOW()"                  // SQL function (raw expression)
   * default: "gen_random_uuid()"      // PostgreSQL UUID generation
   */
  default?: z.infer<T> | string;

  /**
   * Marks this column as the table's PRIMARY KEY.
   * Only one column per table can have primaryKey: true.
   */
  primaryKey?: boolean;

  /**
   * Strategy for auto-generating primary key values.
   * Only meaningful when primaryKey: true.
   *
   * @default "autoincrement" for integer PKs, "uuid" for string PKs
   */
  generatedAs?: GenerationStrategy;

  /**
   * Adds a UNIQUE constraint to this column.
   * Use `unique: true` for single-column uniqueness.
   * For multi-column unique constraints, use `createIndex` with `unique: true`.
   */
  unique?: boolean;

  /**
   * Defines a FOREIGN KEY relationship to another table's column.
   */
  references?: ForeignKeyRef;

  /**
   * Creates an index on this column automatically.
   * Equivalent to calling `createIndex(tableName, [columnName])` separately.
   */
  index?: boolean;

  /**
   * A comment/description stored in the database catalog.
   * Supported by PostgreSQL and MySQL. Ignored in SQLite.
   */
  comment?: string;

  /**
   * CHECK constraints that validate column values.
   * Multiple constraints are combined with AND.
   */
  checks?: CheckConstraint[];
}

// ============================================================
//  Type Utilities
// ============================================================

/**
 * Extracts the TypeScript type of the column's runtime value.
 *
 * @example
 * type EmailValue = InferColumn<{ schema: z.ZodString; unique: true }>
 * // → string
 *
 * type AgeValue = InferColumn<{ schema: z.ZodOptional<z.ZodNumber>; nullable: true }>
 * // → number | undefined
 */
export type InferColumn<T extends ColumnDefinition> = z.infer<T["schema"]>;

/**
 * Checks at compile time whether a ColumnDefinition can hold NULL values.
 *
 * @example
 * type IsNullable1 = IsNullableColumn<{ schema: z.ZodString }>           // false
 * type IsNullable2 = IsNullableColumn<{ schema: z.ZodOptional<z.ZodString> }> // true
 */
export type IsNullableColumn<T extends ColumnDefinition> =
  T["schema"] extends z.ZodOptional<z.ZodTypeAny>
    ? true
    : T["schema"] extends z.ZodNullable<z.ZodTypeAny>
    ? true
    : T["nullable"] extends true
    ? true
    : false;

/**
 * Picks only the columns marked as primary keys from a table schema map.
 */
export type PrimaryKeyColumns<T extends Record<string, ColumnDefinition>> = {
  [K in keyof T as T[K]["primaryKey"] extends true ? K : never]: T[K];
};

/**
 * Picks only the required (non-nullable, no default) columns.
 * Useful for generating INSERT statement type signatures.
 */
export type RequiredColumns<T extends Record<string, ColumnDefinition>> = {
  [K in keyof T as IsNullableColumn<T[K]> extends true
    ? never
    : T[K]["default"] extends undefined
    ? K
    : never]: T[K];
};

/**
 * Picks only the optional columns (nullable or has a default value).
 */
export type OptionalColumns<T extends Record<string, ColumnDefinition>> = {
  [K in keyof T as IsNullableColumn<T[K]> extends true
    ? K
    : T[K]["default"] extends undefined
    ? never
    : K]: T[K];
};
