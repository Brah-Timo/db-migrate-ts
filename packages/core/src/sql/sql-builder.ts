/**
 * @file sql-builder.ts
 * @description SQL statement builder — compiles MigrationOperations into SQL strings.
 *
 * The SqlBuilder takes the internal MigrationOperation objects collected by
 * MigrationBuilderImpl and produces valid SQL DDL statements for the target dialect.
 * It delegates to dialect-specific implementations for operations that differ
 * between PostgreSQL, MySQL, and SQLite.
 */

import type { MigrationOperation, IndexOptions, DropTableOptions, DropIndexOptions, Dialect } from "../types/migration.types.js";
import type { ColumnDefinition } from "../types/column.types.js";
import { ZodToSQLConverter } from "../schema/zod-to-sql.js";
import { computeIndexNameHash } from "../utils/hash.js";
import { UnsupportedDialectOperationError } from "../utils/errors.js";
import { DIALECT_FEATURES } from "../types/dialect.types.js";

// ============================================================
//  SQL Builder
// ============================================================

/**
 * Compiles MigrationOperation objects into SQL strings for a specific dialect.
 *
 * @example
 * const builder = new SqlBuilder("postgres");
 * const statements = builder.compile(operations);
 * // → ["CREATE TABLE \"users\" (...)", "CREATE INDEX ..."]
 */
export class SqlBuilder {
  private readonly converter: ZodToSQLConverter;
  private readonly features: (typeof DIALECT_FEATURES)[Dialect];

  constructor(private readonly dialect: Dialect) {
    this.converter = new ZodToSQLConverter(dialect);
    this.features = DIALECT_FEATURES[dialect];
  }

  /**
   * Compiles an array of MigrationOperations to SQL strings.
   * Returns one SQL string per operation (some operations may expand to multiple statements).
   */
  compile(operations: readonly MigrationOperation[]): string[] {
    const statements: string[] = [];

    for (const op of operations) {
      const sql = this.compileOp(op);
      if (Array.isArray(sql)) {
        statements.push(...sql);
      } else {
        statements.push(sql);
      }
    }

    return statements.filter((s) => s.trim().length > 0);
  }

  // ----------------------------------------------------------
  //  Operation Dispatch
  // ----------------------------------------------------------

  private compileOp(op: MigrationOperation): string | string[] {
    switch (op.type) {
      case "CREATE_TABLE":
        return this.createTable(op.tableName, op.schema);
      case "DROP_TABLE":
        return this.dropTable(op.tableName, op.options);
      case "RENAME_TABLE":
        return this.renameTable(op.from, op.to);
      case "TRUNCATE_TABLE":
        return this.truncateTable(op.tableName);
      case "ADD_COLUMN":
        return this.addColumn(op.tableName, op.columnName, op.definition);
      case "DROP_COLUMN":
        return this.dropColumn(op.tableName, op.columnName);
      case "RENAME_COLUMN":
        return this.renameColumn(op.tableName, op.from, op.to);
      case "ALTER_COLUMN":
        return this.alterColumn(op.tableName, op.columnName, op.newDefinition);
      case "SET_NOT_NULL":
        return this.setNotNull(op.tableName, op.columnName);
      case "DROP_NOT_NULL":
        return this.dropNotNull(op.tableName, op.columnName);
      case "SET_DEFAULT":
        return this.setDefault(op.tableName, op.columnName, op.defaultValue);
      case "DROP_DEFAULT":
        return this.dropDefault(op.tableName, op.columnName);
      case "CREATE_INDEX":
        return this.createIndex(op.tableName, op.columns, op.options);
      case "DROP_INDEX":
        return this.dropIndex(op.indexName, op.options);
      case "ADD_FOREIGN_KEY":
        return this.addForeignKey(op.tableName, op.columnName, op.references);
      case "DROP_FOREIGN_KEY":
        return this.dropForeignKey(op.tableName, op.constraintName);
      case "ADD_CHECK":
        return this.addCheck(op.tableName, op.constraintName, op.expression);
      case "DROP_CHECK":
        return this.dropCheck(op.tableName, op.constraintName);
      case "RAW_SQL":
        return op.sql;
    }
  }

  // ----------------------------------------------------------
  //  CREATE TABLE
  // ----------------------------------------------------------

  createTable(tableName: string, schema: Record<string, ColumnDefinition>): string {
    const q = this.q.bind(this);
    const columnDefs = Object.entries(schema).map(([colName, def]) => {
      const colSQL = this.converter.convert(def);
      return `  ${q(colName)} ${colSQL}`;
    });

    // Collect explicit foreign key constraints for table-level declaration
    const fkConstraints = Object.entries(schema)
      .filter(([, def]) => def.references)
      .map(([colName, def]) => {
        const ref = def.references!;
        let fk = `  CONSTRAINT ${q(`fk_${tableName}_${colName}`)} ` +
          `FOREIGN KEY (${q(colName)}) ` +
          `REFERENCES ${q(ref.table)} (${q(ref.column)})`;
        if (ref.onDelete) fk += ` ON DELETE ${ref.onDelete}`;
        if (ref.onUpdate) fk += ` ON UPDATE ${ref.onUpdate}`;
        return fk;
      });

    // Only add table-level FK declarations for PostgreSQL and MySQL
    // SQLite supports inline FK, but table-level is cleaner
    const allDefs =
      this.dialect === "sqlite"
        ? columnDefs
        : [...columnDefs, ...fkConstraints];

    const body = allDefs.join(",\n");

    return `CREATE TABLE ${q(tableName)} (\n${body}\n)`;
  }

  // ----------------------------------------------------------
  //  DROP TABLE
  // ----------------------------------------------------------

  dropTable(tableName: string, options?: DropTableOptions): string {
    const q = this.q.bind(this);
    const ifExists = options?.ifExists ? "IF EXISTS " : "";
    const cascade = options?.cascade ? " CASCADE" : "";
    return `DROP TABLE ${ifExists}${q(tableName)}${cascade}`;
  }

  // ----------------------------------------------------------
  //  RENAME TABLE
  // ----------------------------------------------------------

  renameTable(from: string, to: string): string {
    const q = this.q.bind(this);
    switch (this.dialect) {
      case "postgres":
        return `ALTER TABLE ${q(from)} RENAME TO ${q(to)}`;
      case "mysql":
        return `RENAME TABLE ${q(from)} TO ${q(to)}`;
      case "sqlite":
        return `ALTER TABLE ${q(from)} RENAME TO ${q(to)}`;
    }
  }

  // ----------------------------------------------------------
  //  TRUNCATE TABLE
  // ----------------------------------------------------------

  truncateTable(tableName: string): string {
    const q = this.q.bind(this);
    switch (this.dialect) {
      case "postgres":
        return `TRUNCATE TABLE ${q(tableName)} RESTART IDENTITY`;
      case "mysql":
        return `TRUNCATE TABLE ${q(tableName)}`;
      case "sqlite":
        // SQLite has no TRUNCATE — use DELETE instead
        return `DELETE FROM ${q(tableName)}`;
    }
  }

  // ----------------------------------------------------------
  //  ADD COLUMN
  // ----------------------------------------------------------

  addColumn(tableName: string, columnName: string, definition: ColumnDefinition): string {
    const q = this.q.bind(this);
    const colSQL = this.converter.convert(definition);
    return `ALTER TABLE ${q(tableName)} ADD COLUMN ${q(columnName)} ${colSQL}`;
  }

  // ----------------------------------------------------------
  //  DROP COLUMN
  // ----------------------------------------------------------

  dropColumn(tableName: string, columnName: string): string {
    const q = this.q.bind(this);
    if (!this.features.dropColumn) {
      throw new UnsupportedDialectOperationError(
        "dropColumn",
        this.dialect,
        "SQLite < 3.35.0 does not support DROP COLUMN. Update SQLite or recreate the table manually."
      );
    }
    return `ALTER TABLE ${q(tableName)} DROP COLUMN ${q(columnName)}`;
  }

  // ----------------------------------------------------------
  //  RENAME COLUMN
  // ----------------------------------------------------------

  renameColumn(tableName: string, from: string, to: string): string {
    const q = this.q.bind(this);
    if (!this.features.renameColumn) {
      throw new UnsupportedDialectOperationError(
        "renameColumn",
        this.dialect,
        "This SQLite version does not support RENAME COLUMN."
      );
    }
    return `ALTER TABLE ${q(tableName)} RENAME COLUMN ${q(from)} TO ${q(to)}`;
  }

  // ----------------------------------------------------------
  //  ALTER COLUMN
  // ----------------------------------------------------------

  alterColumn(
    tableName: string,
    columnName: string,
    newDefinition: ColumnDefinition
  ): string | string[] {
    const q = this.q.bind(this);

    if (!this.features.alterColumnType && this.dialect === "sqlite") {
      throw new UnsupportedDialectOperationError(
        "alterColumn",
        "sqlite",
        "SQLite does not support ALTER COLUMN TYPE. " +
          "You must recreate the table. Use migrate.raw() with the required SQLite table recreation SQL."
      );
    }

    const colSQL = this.converter.convert(newDefinition);

    switch (this.dialect) {
      case "postgres":
        // PostgreSQL requires separate statements for each aspect
        return [
          `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} TYPE ${this.converter.getBaseType(newDefinition)}`,
          ...(newDefinition.nullable === false
            ? [`ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} SET NOT NULL`]
            : [`ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} DROP NOT NULL`]),
          ...(newDefinition.default !== undefined
            ? [
                `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} SET DEFAULT ${
                  typeof newDefinition.default === "string"
                    ? `'${newDefinition.default}'`
                    : String(newDefinition.default)
                }`,
              ]
            : []),
        ];
      case "mysql":
        // MySQL uses MODIFY COLUMN which takes the full column definition
        return `ALTER TABLE ${q(tableName)} MODIFY COLUMN ${q(columnName)} ${colSQL}`;

      case "sqlite":
        throw new UnsupportedDialectOperationError("alterColumn", "sqlite");
    }
  }

  // ----------------------------------------------------------
  //  SET / DROP NOT NULL
  // ----------------------------------------------------------

  setNotNull(tableName: string, columnName: string): string {
    const q = this.q.bind(this);
    switch (this.dialect) {
      case "postgres":
        return `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} SET NOT NULL`;
      case "mysql":
        throw new UnsupportedDialectOperationError(
          "setNotNull",
          "mysql",
          "Use alterColumn with the full column definition instead."
        );
      case "sqlite":
        throw new UnsupportedDialectOperationError("setNotNull", "sqlite");
    }
  }

  dropNotNull(tableName: string, columnName: string): string {
    const q = this.q.bind(this);
    switch (this.dialect) {
      case "postgres":
        return `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} DROP NOT NULL`;
      case "mysql":
        throw new UnsupportedDialectOperationError(
          "dropNotNull",
          "mysql",
          "Use alterColumn with the full column definition instead."
        );
      case "sqlite":
        throw new UnsupportedDialectOperationError("dropNotNull", "sqlite");
    }
  }

  // ----------------------------------------------------------
  //  SET / DROP DEFAULT
  // ----------------------------------------------------------

  setDefault(tableName: string, columnName: string, defaultValue: unknown): string {
    const q = this.q.bind(this);
    const formatted = this.formatDefault(defaultValue);

    switch (this.dialect) {
      case "postgres":
        return `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} SET DEFAULT ${formatted}`;
      case "mysql":
        throw new UnsupportedDialectOperationError(
          "setDefault",
          "mysql",
          "Use alterColumn with the full column definition instead."
        );
      case "sqlite":
        throw new UnsupportedDialectOperationError("setDefault", "sqlite");
    }
  }

  dropDefault(tableName: string, columnName: string): string {
    const q = this.q.bind(this);
    switch (this.dialect) {
      case "postgres":
        return `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} DROP DEFAULT`;
      case "mysql":
        throw new UnsupportedDialectOperationError("dropDefault", "mysql");
      case "sqlite":
        throw new UnsupportedDialectOperationError("dropDefault", "sqlite");
    }
  }

  // ----------------------------------------------------------
  //  CREATE INDEX
  // ----------------------------------------------------------

  createIndex(tableName: string, columns: string[], options?: IndexOptions): string {
    const q = this.q.bind(this);

    // Generate index name if not provided
    const indexName =
      options?.name ?? `idx_${tableName}_${computeIndexNameHash(tableName, columns)}`;

    const unique = options?.unique ? "UNIQUE " : "";
    const concurrent =
      options?.concurrently && this.features.concurrentIndexes ? "CONCURRENTLY " : "";
    const using =
      options?.using && this.features.partialIndexes
        ? ` USING ${options.using.toUpperCase()}`
        : "";
    const where =
      options?.where && this.features.partialIndexes ? ` WHERE ${options.where}` : "";
    const cols = columns.map((c) => q(c)).join(", ");

    return `CREATE ${unique}INDEX ${concurrent}${q(indexName)} ON ${q(tableName)}${using} (${cols})${where}`;
  }

  // ----------------------------------------------------------
  //  DROP INDEX
  // ----------------------------------------------------------

  dropIndex(indexName: string, options?: DropIndexOptions): string {
    const q = this.q.bind(this);
    const ifExists = options?.ifExists ? "IF EXISTS " : "";
    const concurrent =
      options?.concurrently && this.features.concurrentIndexes ? "CONCURRENTLY " : "";
    const cascade = options?.cascade ? " CASCADE" : "";

    switch (this.dialect) {
      case "postgres":
        return `DROP INDEX ${concurrent}${ifExists}${q(indexName)}${cascade}`;
      case "mysql":
        // MySQL requires the table name — we don't have it here, so use a workaround
        return `DROP INDEX ${q(indexName)} ON ${q("__TABLE__")}`;
      case "sqlite":
        return `DROP INDEX ${ifExists}${q(indexName)}`;
    }
  }

  // ----------------------------------------------------------
  //  FOREIGN KEY CONSTRAINTS
  // ----------------------------------------------------------

  addForeignKey(
    tableName: string,
    columnName: string,
    refs: { table: string; column: string; name?: string; onDelete?: string; onUpdate?: string }
  ): string {
    const q = this.q.bind(this);
    const constraintName = refs.name ?? `fk_${tableName}_${columnName}`;
    let sql =
      `ALTER TABLE ${q(tableName)} ADD CONSTRAINT ${q(constraintName)} ` +
      `FOREIGN KEY (${q(columnName)}) REFERENCES ${q(refs.table)} (${q(refs.column)})`;
    if (refs.onDelete) sql += ` ON DELETE ${refs.onDelete}`;
    if (refs.onUpdate) sql += ` ON UPDATE ${refs.onUpdate}`;
    return sql;
  }

  dropForeignKey(tableName: string, constraintName: string): string {
    const q = this.q.bind(this);
    switch (this.dialect) {
      case "postgres":
      case "sqlite":
        return `ALTER TABLE ${q(tableName)} DROP CONSTRAINT ${q(constraintName)}`;
      case "mysql":
        return `ALTER TABLE ${q(tableName)} DROP FOREIGN KEY ${q(constraintName)}`;
    }
  }

  // ----------------------------------------------------------
  //  CHECK CONSTRAINTS
  // ----------------------------------------------------------

  addCheck(tableName: string, constraintName: string, expression: string): string {
    const q = this.q.bind(this);
    return (
      `ALTER TABLE ${q(tableName)} ADD CONSTRAINT ${q(constraintName)} ` +
      `CHECK (${expression})`
    );
  }

  dropCheck(tableName: string, constraintName: string): string {
    const q = this.q.bind(this);
    switch (this.dialect) {
      case "postgres":
      case "sqlite":
        return `ALTER TABLE ${q(tableName)} DROP CONSTRAINT ${q(constraintName)}`;
      case "mysql":
        return `ALTER TABLE ${q(tableName)} DROP CHECK ${q(constraintName)}`;
    }
  }

  // ----------------------------------------------------------
  //  Utilities
  // ----------------------------------------------------------

  /**
   * Quotes an identifier for the target dialect.
   */
  private q(name: string): string {
    switch (this.dialect) {
      case "postgres":
        return `"${name.replace(/"/g, '""')}"`;
      case "mysql":
        return `\`${name.replace(/`/g, "``")}\``;
      case "sqlite":
        return `"${name.replace(/"/g, '""')}"`;
    }
  }

  private formatDefault(value: unknown): string {
    if (value === null) return "NULL";
    if (typeof value === "string") {
      // SQL functions pass through as-is
      if (value.includes("(") || /^[A-Z_]+$/.test(value)) return value;
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === "boolean") {
      switch (this.dialect) {
        case "postgres":
          return value ? "TRUE" : "FALSE";
        default:
          return value ? "1" : "0";
      }
    }
    return String(value);
  }
}
