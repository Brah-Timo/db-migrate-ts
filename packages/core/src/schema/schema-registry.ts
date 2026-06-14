/**
 * @file schema-registry.ts
 * @description The Schema Registry — stores and provides type-safe access to the
 * current database schema definition.
 *
 * The registry is the single source of truth for what tables and columns exist
 * in your database. It powers:
 *   - Type-safe table name validation at compile time
 *   - Type-safe column name validation at compile time
 *   - Schema diffing (comparing old schema vs new schema to detect changes)
 *   - Auto-suggestion for the CLI status and validate commands
 */

import type {
  DatabaseSchema,
  TableName,
  ColumnName,
  TableSchema,
} from "../types/table.types.js";
import type { ColumnDefinition } from "../types/column.types.js";
import { SchemaValidationError } from "../utils/errors.js";

// ============================================================
//  Schema Registry
// ============================================================

/**
 * A runtime registry that holds your database schema definition.
 *
 * @template TDb - The TypeScript DatabaseSchema type (for compile-time inference)
 *
 * @example
 * const registry = new SchemaRegistry({
 *   users: {
 *     id:    { schema: z.string().uuid(), primaryKey: true },
 *     email: { schema: z.string().email(), unique: true },
 *     name:  { schema: z.string().max(100) },
 *   },
 *   posts: {
 *     id:       { schema: z.number().int(), primaryKey: true },
 *     title:    { schema: z.string().max(255) },
 *     authorId: { schema: z.string().uuid(), references: { table: "users", column: "id" } },
 *   },
 * });
 *
 * registry.getTableNames();   // ["users", "posts"]
 * registry.getTable("users"); // { id: {...}, email: {...}, name: {...} }
 */
export class SchemaRegistry<TDb extends DatabaseSchema = DatabaseSchema> {
  private readonly schema: TDb;
  private readonly tableNames: Set<string>;

  constructor(schema: TDb) {
    this.schema = schema;
    this.tableNames = new Set(Object.keys(schema));
  }

  // ----------------------------------------------------------
  //  Table Access
  // ----------------------------------------------------------

  /**
   * Returns all table names defined in the schema.
   */
  getTableNames(): TableName<TDb>[] {
    return Object.keys(this.schema) as TableName<TDb>[];
  }

  /**
   * Returns the column schema for a specific table.
   *
   * @throws SchemaValidationError if the table doesn't exist
   */
  getTable<TName extends TableName<TDb>>(tableName: TName): TDb[TName] {
    const table = this.schema[tableName];
    if (!table) {
      throw new SchemaValidationError([
        `Table "${String(tableName)}" is not defined in the schema registry. ` +
          `Available tables: ${this.getTableNames().join(", ")}`,
      ]);
    }
    return table;
  }

  /**
   * Checks whether a table exists in the schema.
   */
  hasTable(tableName: string): tableName is TableName<TDb> {
    return this.tableNames.has(tableName);
  }

  // ----------------------------------------------------------
  //  Column Access
  // ----------------------------------------------------------

  /**
   * Returns the column names for a specific table.
   */
  getColumnNames<TName extends TableName<TDb>>(tableName: TName): ColumnName<TDb, TName>[] {
    const table = this.getTable(tableName);
    return Object.keys(table) as ColumnName<TDb, TName>[];
  }

  /**
   * Returns the definition of a specific column.
   *
   * @throws SchemaValidationError if the column doesn't exist
   */
  getColumn<TName extends TableName<TDb>, TCol extends ColumnName<TDb, TName>>(
    tableName: TName,
    columnName: TCol
  ): ColumnDefinition {
    const table = this.getTable(tableName);
    const column = (table as TableSchema)[columnName as string];
    if (!column) {
      const available = this.getColumnNames(tableName).join(", ");
      throw new SchemaValidationError([
        `Column "${String(columnName)}" doesn't exist in table "${String(tableName)}". ` +
          `Available columns: ${available}`,
      ]);
    }
    return column;
  }

  /**
   * Checks whether a column exists in a table.
   */
  hasColumn<TName extends TableName<TDb>>(tableName: TName, columnName: string): boolean {
    if (!this.hasTable(tableName)) return false;
    const table = this.schema[tableName] as TableSchema;
    return columnName in table;
  }

  // ----------------------------------------------------------
  //  Schema Introspection
  // ----------------------------------------------------------

  /**
   * Returns the primary key column(s) for a table.
   */
  getPrimaryKeys<TName extends TableName<TDb>>(tableName: TName): string[] {
    const table = this.getTable(tableName) as TableSchema;
    return Object.entries(table)
      .filter(([, def]) => def.primaryKey === true)
      .map(([name]) => name);
  }

  /**
   * Returns all columns with UNIQUE constraints in a table.
   */
  getUniqueColumns<TName extends TableName<TDb>>(tableName: TName): string[] {
    const table = this.getTable(tableName) as TableSchema;
    return Object.entries(table)
      .filter(([, def]) => def.unique === true)
      .map(([name]) => name);
  }

  /**
   * Returns all foreign key columns in a table.
   */
  getForeignKeys<TName extends TableName<TDb>>(
    tableName: TName
  ): Array<{ columnName: string; references: NonNullable<ColumnDefinition["references"]> }> {
    const table = this.getTable(tableName) as TableSchema;
    return Object.entries(table)
      .filter(([, def]) => def.references !== undefined)
      .map(([columnName, def]) => ({
        columnName,
        references: def.references!,
      }));
  }

  /**
   * Returns all tables that reference a given table via foreign keys.
   */
  getDependentTables(targetTable: string): string[] {
    const dependents: string[] = [];

    for (const tableName of this.getTableNames()) {
      const fks = this.getForeignKeys(tableName);
      if (fks.some((fk) => fk.references.table === targetTable)) {
        dependents.push(String(tableName));
      }
    }

    return dependents;
  }

  // ----------------------------------------------------------
  //  Serialization
  // ----------------------------------------------------------

  /**
   * Returns the raw schema object.
   * Useful for serialization, diffing, or passing to external tools.
   */
  toJSON(): DatabaseSchema {
    return this.schema as DatabaseSchema;
  }

  /**
   * Returns a summary of the schema (table names + column counts).
   */
  getSummary(): Array<{ table: string; columns: number; hasPrimaryKey: boolean }> {
    return this.getTableNames().map((tableName) => ({
      table: String(tableName),
      columns: this.getColumnNames(tableName).length,
      hasPrimaryKey: this.getPrimaryKeys(tableName).length > 0,
    }));
  }
}

// ============================================================
//  Factory Function
// ============================================================

/**
 * Creates a typed SchemaRegistry from a DatabaseSchema definition.
 *
 * @example
 * const registry = createRegistry({
 *   users: { id: { schema: z.string().uuid(), primaryKey: true } },
 * });
 */
export function createRegistry<TDb extends DatabaseSchema>(
  schema: TDb
): SchemaRegistry<TDb> {
  return new SchemaRegistry(schema);
}
