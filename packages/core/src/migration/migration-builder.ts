/**
 * @file migration-builder.ts
 * @description The fluent Migration Builder implementation.
 *
 * MigrationBuilderImpl collects DDL operations as an ordered list of
 * MigrationOperation objects. When compile() is called, it delegates to
 * the appropriate SqlBuilder to produce SQL strings for the target dialect.
 *
 * Design pattern: Command pattern — operations are recorded first, then
 * compiled to SQL in a single pass, enabling dry-run mode, SQL snapshots,
 * and pre-execution validation.
 */

import type {
  MigrationBuilder,
  MigrationOperation,
  DropTableOptions,
  IndexOptions,
  DropIndexOptions,
  ForeignKeyConstraint,
  Dialect,
} from "../types/migration.types.js";
import type { DatabaseSchema, TableName, ColumnName } from "../types/table.types.js";
import type { ColumnDefinition } from "../types/column.types.js";
import { EmptyTableSchemaError, InvalidRenameError } from "../utils/errors.js";

// ============================================================
//  MigrationBuilderImpl
// ============================================================

/**
 * Concrete implementation of the MigrationBuilder interface.
 *
 * @template TDb - The database schema type for compile-time name validation
 */
export class MigrationBuilderImpl<TDb extends DatabaseSchema = DatabaseSchema>
  implements MigrationBuilder<TDb>
{
  /** Ordered list of operations collected during the migration function */
  private readonly ops: MigrationOperation[] = [];

  /** The target dialect — used during compilation */
  readonly dialect: Dialect;

  constructor(dialect: Dialect) {
    this.dialect = dialect;
  }

  // ----------------------------------------------------------
  //  Table Operations
  // ----------------------------------------------------------

  createTable<TSchema extends Record<string, ColumnDefinition>>(
    tableName: string,
    schema: TSchema
  ): this {
    if (Object.keys(schema).length === 0) {
      throw new EmptyTableSchemaError(tableName);
    }

    this.ops.push({ type: "CREATE_TABLE", tableName, schema });
    return this;
  }

  dropTable<TName extends TableName<TDb>>(
    tableName: TName,
    options?: DropTableOptions
  ): this {
    this.ops.push({ type: "DROP_TABLE", tableName: String(tableName), ...(options !== undefined ? { options } : {}) });
    return this;
  }

  renameTable<TName extends TableName<TDb>>(from: TName, to: string): this {
    if (String(from) === to) {
      throw new InvalidRenameError("table", String(from), to);
    }
    this.ops.push({ type: "RENAME_TABLE", from: String(from), to });
    return this;
  }

  truncateTable<TName extends TableName<TDb>>(tableName: TName): this {
    this.ops.push({ type: "TRUNCATE_TABLE", tableName: String(tableName) });
    return this;
  }

  // ----------------------------------------------------------
  //  Column Operations
  // ----------------------------------------------------------

  addColumn<TName extends TableName<TDb>>(
    tableName: TName,
    columnName: string,
    definition: ColumnDefinition
  ): this {
    this.ops.push({
      type: "ADD_COLUMN",
      tableName: String(tableName),
      columnName,
      definition,
    });
    return this;
  }

  dropColumn<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(tableName: TName, columnName: TCol): this {
    this.ops.push({
      type: "DROP_COLUMN",
      tableName: String(tableName),
      columnName: String(columnName),
    });
    return this;
  }

  renameColumn<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(tableName: TName, from: TCol, to: string): this {
    if (String(from) === to) {
      throw new InvalidRenameError("column", String(from), to);
    }
    this.ops.push({
      type: "RENAME_COLUMN",
      tableName: String(tableName),
      from: String(from),
      to,
    });
    return this;
  }

  alterColumn<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(tableName: TName, columnName: TCol, newDefinition: ColumnDefinition): this {
    this.ops.push({
      type: "ALTER_COLUMN",
      tableName: String(tableName),
      columnName: String(columnName),
      newDefinition,
    });
    return this;
  }

  setNotNull<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(tableName: TName, columnName: TCol): this {
    this.ops.push({
      type: "SET_NOT_NULL",
      tableName: String(tableName),
      columnName: String(columnName),
    });
    return this;
  }

  dropNotNull<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(tableName: TName, columnName: TCol): this {
    this.ops.push({
      type: "DROP_NOT_NULL",
      tableName: String(tableName),
      columnName: String(columnName),
    });
    return this;
  }

  setDefault<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(tableName: TName, columnName: TCol, defaultValue: unknown): this {
    this.ops.push({
      type: "SET_DEFAULT",
      tableName: String(tableName),
      columnName: String(columnName),
      defaultValue,
    });
    return this;
  }

  dropDefault<
    TName extends TableName<TDb>,
    TCol extends ColumnName<TDb, TName>,
  >(tableName: TName, columnName: TCol): this {
    this.ops.push({
      type: "DROP_DEFAULT",
      tableName: String(tableName),
      columnName: String(columnName),
    });
    return this;
  }

  // ----------------------------------------------------------
  //  Index Operations
  // ----------------------------------------------------------

  createIndex<TName extends TableName<TDb>>(
    tableName: TName,
    columns: ColumnName<TDb, TName>[],
    options?: IndexOptions
  ): this {
    this.ops.push({
      type: "CREATE_INDEX",
      tableName: String(tableName),
      columns: columns.map(String),
      ...(options !== undefined ? { options } : {}),
    });
    return this;
  }

  dropIndex(indexName: string, options?: DropIndexOptions): this {
    this.ops.push({ type: "DROP_INDEX", indexName, ...(options !== undefined ? { options } : {}) });
    return this;
  }

  // ----------------------------------------------------------
  //  Constraint Operations
  // ----------------------------------------------------------

  addForeignKey<TName extends TableName<TDb>>(
    tableName: TName,
    columnName: string,
    references: ForeignKeyConstraint
  ): this {
    this.ops.push({
      type: "ADD_FOREIGN_KEY",
      tableName: String(tableName),
      columnName,
      references,
    });
    return this;
  }

  dropForeignKey<TName extends TableName<TDb>>(
    tableName: TName,
    constraintName: string
  ): this {
    this.ops.push({
      type: "DROP_FOREIGN_KEY",
      tableName: String(tableName),
      constraintName,
    });
    return this;
  }

  addCheck<TName extends TableName<TDb>>(
    tableName: TName,
    constraintName: string,
    expression: string
  ): this {
    this.ops.push({
      type: "ADD_CHECK",
      tableName: String(tableName),
      constraintName,
      expression,
    });
    return this;
  }

  dropCheck<TName extends TableName<TDb>>(
    tableName: TName,
    constraintName: string
  ): this {
    this.ops.push({
      type: "DROP_CHECK",
      tableName: String(tableName),
      constraintName,
    });
    return this;
  }

  // ----------------------------------------------------------
  //  Raw SQL
  // ----------------------------------------------------------

  raw(sql: string, bindings?: unknown[]): this {
    const trimmed = sql.trim();
    if (!trimmed) {
      throw new Error("[db-migrate-ts] raw(): SQL string cannot be empty.");
    }
    this.ops.push({ type: "RAW_SQL", sql: trimmed, ...(bindings !== undefined ? { bindings } : {}) });
    return this;
  }

  // ----------------------------------------------------------
  //  Compilation & Introspection
  // ----------------------------------------------------------

  /**
   * Returns the collected operations as a readonly array.
   * Used by MigrationRunner and the GUI to inspect operations before compilation.
   */
  getOperations(): readonly MigrationOperation[] {
    return this.ops;
  }

  /**
   * Returns a copy of the operations list.
   */
  cloneOperations(): MigrationOperation[] {
    return [...this.ops];
  }

  /**
   * Returns true if the builder has no operations.
   */
  isEmpty(): boolean {
    return this.ops.length === 0;
  }

  /**
   * Returns the number of operations collected.
   */
  getOperationCount(): number {
    return this.ops.length;
  }

  /**
   * Clears all collected operations.
   * Useful for resetting the builder in test scenarios.
   */
  clear(): void {
    this.ops.length = 0;
  }

  /**
   * Returns a human-readable summary of all operations.
   * Used for dry-run output.
   */
  summarize(): string {
    if (this.ops.length === 0) {
      return "(no operations)";
    }
    return this.ops
      .map((op, i) => `  ${i + 1}. ${this.describeOp(op)}`)
      .join("\n");
  }

  private describeOp(op: MigrationOperation): string {
    switch (op.type) {
      case "CREATE_TABLE":
        return `CREATE TABLE "${op.tableName}" (${Object.keys(op.schema).length} columns)`;
      case "DROP_TABLE":
        return `DROP TABLE "${op.tableName}"${op.options?.cascade ? " CASCADE" : ""}`;
      case "RENAME_TABLE":
        return `RENAME TABLE "${op.from}" → "${op.to}"`;
      case "TRUNCATE_TABLE":
        return `TRUNCATE TABLE "${op.tableName}"`;
      case "ADD_COLUMN":
        return `ADD COLUMN "${op.tableName}"."${op.columnName}"`;
      case "DROP_COLUMN":
        return `DROP COLUMN "${op.tableName}"."${op.columnName}"`;
      case "RENAME_COLUMN":
        return `RENAME COLUMN "${op.tableName}"."${op.from}" → "${op.to}"`;
      case "ALTER_COLUMN":
        return `ALTER COLUMN "${op.tableName}"."${op.columnName}"`;
      case "SET_NOT_NULL":
        return `SET NOT NULL "${op.tableName}"."${op.columnName}"`;
      case "DROP_NOT_NULL":
        return `DROP NOT NULL "${op.tableName}"."${op.columnName}"`;
      case "SET_DEFAULT":
        return `SET DEFAULT "${op.tableName}"."${op.columnName}" = ${JSON.stringify(op.defaultValue)}`;
      case "DROP_DEFAULT":
        return `DROP DEFAULT "${op.tableName}"."${op.columnName}"`;
      case "CREATE_INDEX":
        return `CREATE INDEX ON "${op.tableName}" (${op.columns.join(", ")})`;
      case "DROP_INDEX":
        return `DROP INDEX "${op.indexName}"`;
      case "ADD_FOREIGN_KEY":
        return `ADD FOREIGN KEY "${op.tableName}"."${op.columnName}" → "${op.references.table}"."${op.references.column}"`;
      case "DROP_FOREIGN_KEY":
        return `DROP FOREIGN KEY "${op.constraintName}" ON "${op.tableName}"`;
      case "ADD_CHECK":
        return `ADD CHECK "${op.constraintName}" ON "${op.tableName}"`;
      case "DROP_CHECK":
        return `DROP CHECK "${op.constraintName}" ON "${op.tableName}"`;
      case "RAW_SQL":
        return `RAW SQL: ${op.sql.slice(0, 80)}${op.sql.length > 80 ? "..." : ""}`;
    }
  }
}
