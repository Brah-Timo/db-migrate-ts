import { z } from 'zod';
import { createHash } from 'crypto';
import chalk2 from 'chalk';
import { mkdir, writeFile, stat, readdir } from 'fs/promises';
import { join, resolve, extname, basename } from 'path';

/**
 * db-migrate-ts v1.0.0
 * Type-safe database migrations powered by Zod and TypeScript
 * License: MIT — https://github.com/db-migrate-ts/db-migrate-ts
 */


// src/utils/errors.ts
var MigrationError = class extends Error {
  code;
  context;
  constructor(message, code, context = {}) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    this.context = context;
    Object.setPrototypeOf(this, new.target.prototype);
  }
  toString() {
    const contextStr = Object.keys(this.context).length ? "\nContext: " + JSON.stringify(this.context, null, 2) : "";
    return `[${this.name}] ${this.code}: ${this.message}${contextStr}`;
  }
};
var MigrationLoadError = class extends MigrationError {
  constructor(migrationName, cause) {
    super(
      `Failed to load migration "${migrationName}": ${cause}`,
      "MIGRATION_LOAD_ERROR",
      { migrationName, cause }
    );
    this.name = "MigrationLoadError";
  }
};
var ChecksumMismatchError = class extends MigrationError {
  constructor(migrationName, expected, actual) {
    super(
      `Checksum mismatch for migration "${migrationName}". This migration was already executed but its content has changed. Expected: ${expected}, Got: ${actual}. Never edit a migration after it has been executed on any environment.`,
      "CHECKSUM_MISMATCH",
      { migrationName, expected, actual }
    );
    this.name = "ChecksumMismatchError";
  }
};
var MigrationExecutionError = class extends MigrationError {
  constructor(migrationName, direction, cause) {
    super(
      `Migration "${migrationName}" (${direction}) failed: ${cause.message}`,
      "MIGRATION_EXECUTION_ERROR",
      { migrationName, direction, originalError: cause.message }
    );
    this.name = "MigrationExecutionError";
    this.cause = cause;
  }
};
var MigrationsDirNotFoundError = class extends MigrationError {
  constructor(dir) {
    super(
      `Migrations directory not found: "${dir}". Create it manually or run "db-migrate-ts generate <name>" to create your first migration.`,
      "MIGRATIONS_DIR_NOT_FOUND",
      { dir }
    );
    this.name = "MigrationsDirNotFoundError";
  }
};
var DatabaseConnectionError = class extends MigrationError {
  constructor(dialect, cause) {
    super(
      `Failed to connect to ${dialect} database: ${cause}`,
      "DATABASE_CONNECTION_ERROR",
      { dialect, cause }
    );
    this.name = "DatabaseConnectionError";
  }
};
var SchemaValidationError = class extends MigrationError {
  violations;
  constructor(violations) {
    super(
      `Schema validation failed with ${violations.length} violation(s):
` + violations.map((v, i) => `  ${i + 1}. ${v}`).join("\n"),
      "SCHEMA_VALIDATION_ERROR",
      { violations }
    );
    this.name = "SchemaValidationError";
    this.violations = violations;
  }
};
var UnsupportedDialectOperationError = class extends MigrationError {
  constructor(operation, dialect, reason) {
    super(
      `Operation "${operation}" is not supported in ${dialect} dialect. ` + (reason ? reason : ""),
      "UNSUPPORTED_DIALECT_OPERATION",
      { operation, dialect }
    );
    this.name = "UnsupportedDialectOperationError";
  }
};
var EmptyTableSchemaError = class extends MigrationError {
  constructor(tableName) {
    super(
      `Cannot create table "${tableName}" with an empty schema. Define at least one column.`,
      "EMPTY_TABLE_SCHEMA",
      { tableName }
    );
    this.name = "EmptyTableSchemaError";
  }
};
var InvalidRenameError = class extends MigrationError {
  constructor(kind, from, to) {
    super(
      `Cannot rename ${kind}: "from" and "to" are the same ("${from}"). Provide different names.`,
      "INVALID_RENAME",
      { kind, from, to }
    );
    this.name = "InvalidRenameError";
  }
};

// src/schema/schema-validator.ts
var SchemaValidator = class {
  /**
   * Validates the full database schema.
   *
   * @param schema - The DatabaseSchema to validate
   * @returns Validation result with errors and warnings
   */
  validate(schema) {
    const errors = [];
    const warnings = [];
    if (Object.keys(schema).length === 0) {
      warnings.push(
        "Schema is empty \u2014 no tables defined. Add tables to enable type-safe migrations."
      );
      return { valid: true, errors, warnings };
    }
    for (const [tableName, tableSchema] of Object.entries(schema)) {
      this.validateTableName(tableName, errors);
      this.validateTable(tableName, tableSchema, errors, warnings);
    }
    this.validateForeignKeyReferences(schema, errors, warnings);
    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  /**
   * Validates and throws if there are any errors.
   *
   * @throws SchemaValidationError if the schema is invalid
   */
  validateOrThrow(schema) {
    const result = this.validate(schema);
    if (!result.valid) {
      throw new SchemaValidationError(result.errors);
    }
  }
  // ----------------------------------------------------------
  //  Table Name Validation
  // ----------------------------------------------------------
  validateTableName(tableName, errors) {
    if (!tableName) {
      errors.push("Table name cannot be empty.");
      return;
    }
    const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!VALID_IDENTIFIER.test(tableName)) {
      errors.push(
        `Table name "${tableName}" is not a valid SQL identifier. Use only letters, numbers, and underscores. Must start with a letter or underscore.`
      );
    }
    const SQL_RESERVED = [
      "user",
      "order",
      "group",
      "select",
      "insert",
      "update",
      "delete",
      "table",
      "column",
      "index"
    ];
    if (SQL_RESERVED.includes(tableName.toLowerCase())) {
      errors.push(
        `Table name "${tableName}" is a reserved SQL keyword. Consider renaming it (e.g., "${tableName}s" or "${tableName}_records") to avoid quoting issues across different databases.`
      );
    }
  }
  // ----------------------------------------------------------
  //  Table Schema Validation
  // ----------------------------------------------------------
  validateTable(tableName, tableSchema, errors, warnings) {
    const columnNames = Object.keys(tableSchema);
    if (columnNames.length === 0) {
      errors.push(`Table "${tableName}" has no columns defined.`);
      return;
    }
    const primaryKeys = [];
    for (const [columnName, definition] of Object.entries(tableSchema)) {
      this.validateColumnName(tableName, columnName, errors);
      this.validateColumnDefinition(tableName, columnName, definition, errors, warnings);
      if (definition.primaryKey) {
        primaryKeys.push(columnName);
      }
    }
    if (primaryKeys.length > 1) {
      errors.push(
        `Table "${tableName}" has multiple primary key columns: ${primaryKeys.join(", ")}. Use a single primaryKey: true column, then use createIndex with unique: true for composite primary keys.`
      );
    }
    if (primaryKeys.length === 0) {
      warnings.push(
        `Table "${tableName}" has no primary key defined. Consider adding an "id" column with primaryKey: true.`
      );
    }
  }
  // ----------------------------------------------------------
  //  Column Name Validation
  // ----------------------------------------------------------
  validateColumnName(tableName, columnName, errors) {
    if (!columnName) {
      errors.push(`Table "${tableName}" has an empty column name.`);
      return;
    }
    const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!VALID_IDENTIFIER.test(columnName)) {
      errors.push(
        `Column "${columnName}" in table "${tableName}" is not a valid SQL identifier. Use only letters, numbers, and underscores.`
      );
    }
  }
  // ----------------------------------------------------------
  //  Column Definition Validation
  // ----------------------------------------------------------
  validateColumnDefinition(tableName, columnName, definition, errors, warnings) {
    if (!definition.schema) {
      errors.push(
        `Column "${tableName}.${columnName}" is missing a Zod schema. Add a "schema" property with a Zod type.`
      );
      return;
    }
    if (!(definition.schema instanceof z.ZodType)) {
      errors.push(
        `Column "${tableName}.${columnName}" has an invalid "schema" value. Expected a Zod schema (e.g., z.string(), z.number()), got: ${typeof definition.schema}`
      );
      return;
    }
    if (definition.primaryKey && definition.nullable) {
      errors.push(
        `Column "${tableName}.${columnName}" cannot be both primaryKey and nullable.`
      );
    }
    if (definition.primaryKey && definition.schema instanceof z.ZodOptional) {
      warnings.push(
        `Column "${tableName}.${columnName}" is a primary key but uses z.optional(). Primary keys are implicitly NOT NULL. Consider using a non-optional schema.`
      );
    }
    if (definition.schema instanceof z.ZodBoolean && definition.default === void 0 && !definition.nullable) {
      warnings.push(
        `Column "${tableName}.${columnName}" is a boolean NOT NULL column with no default value. Consider adding "default: false" or "default: true".`
      );
    }
  }
  // ----------------------------------------------------------
  //  Foreign Key Cross-Table Validation
  // ----------------------------------------------------------
  validateForeignKeyReferences(schema, errors, warnings) {
    const allTableNames = new Set(Object.keys(schema));
    for (const [tableName, tableSchema] of Object.entries(schema)) {
      for (const [columnName, definition] of Object.entries(tableSchema)) {
        const ref = definition.references;
        if (!ref) continue;
        if (!allTableNames.has(ref.table)) {
          errors.push(
            `Column "${tableName}.${columnName}" references table "${ref.table}" which is not defined in the schema. Available tables: ${[...allTableNames].join(", ")}`
          );
          continue;
        }
        const refTable = schema[ref.table];
        if (refTable && !(ref.column in refTable)) {
          const availableCols = Object.keys(refTable).join(", ");
          errors.push(
            `Column "${tableName}.${columnName}" references "${ref.table}.${ref.column}" but column "${ref.column}" doesn't exist in table "${ref.table}". Available columns: ${availableCols}`
          );
          continue;
        }
        if (refTable) {
          const refColDef = refTable[ref.column];
          if (refColDef && !refColDef.primaryKey && !refColDef.unique) {
            warnings.push(
              `Column "${tableName}.${columnName}" references "${ref.table}.${ref.column}" which is neither a primary key nor has a UNIQUE constraint. Foreign keys should reference unique columns for data integrity.`
            );
          }
        }
      }
    }
  }
};
function validateSchema(schema) {
  return new SchemaValidator().validate(schema);
}
function validateSchemaOrThrow(schema) {
  return new SchemaValidator().validateOrThrow(schema);
}

// src/config.ts
function defineConfig(config) {
  if (!config.adapter) {
    throw new Error(
      '[db-migrate-ts] defineConfig: "adapter" is required. Expected: "postgres", "mysql", or "sqlite".'
    );
  }
  if (!["postgres", "mysql", "sqlite"].includes(config.adapter)) {
    throw new Error(
      `[db-migrate-ts] defineConfig: Unknown adapter "${config.adapter}". Expected: "postgres", "mysql", or "sqlite".`
    );
  }
  if (!config.connection) {
    throw new Error('[db-migrate-ts] defineConfig: "connection" is required.');
  }
  if (!config.migrationsDir) {
    throw new Error('[db-migrate-ts] defineConfig: "migrationsDir" is required.');
  }
  if (config.schema) {
    const validator = new SchemaValidator();
    const result = validator.validate(config.schema);
    if (result.warnings.length > 0) {
      result.warnings.forEach(
        (w) => console.warn(`[db-migrate-ts] Schema warning: ${w}`)
      );
    }
    if (!result.valid) {
      const errorList = result.errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n");
      throw new Error(
        `[db-migrate-ts] defineConfig: Schema validation failed:
${errorList}`
      );
    }
  }
  return config;
}

// src/migration/migration-builder.ts
var MigrationBuilderImpl = class {
  /** Ordered list of operations collected during the migration function */
  ops = [];
  /** The target dialect — used during compilation */
  dialect;
  constructor(dialect) {
    this.dialect = dialect;
  }
  // ----------------------------------------------------------
  //  Table Operations
  // ----------------------------------------------------------
  createTable(tableName, schema) {
    if (Object.keys(schema).length === 0) {
      throw new EmptyTableSchemaError(tableName);
    }
    this.ops.push({ type: "CREATE_TABLE", tableName, schema });
    return this;
  }
  dropTable(tableName, options) {
    this.ops.push({ type: "DROP_TABLE", tableName: String(tableName), options });
    return this;
  }
  renameTable(from, to) {
    if (String(from) === to) {
      throw new InvalidRenameError("table", String(from), to);
    }
    this.ops.push({ type: "RENAME_TABLE", from: String(from), to });
    return this;
  }
  truncateTable(tableName) {
    this.ops.push({ type: "TRUNCATE_TABLE", tableName: String(tableName) });
    return this;
  }
  // ----------------------------------------------------------
  //  Column Operations
  // ----------------------------------------------------------
  addColumn(tableName, columnName, definition) {
    this.ops.push({
      type: "ADD_COLUMN",
      tableName: String(tableName),
      columnName,
      definition
    });
    return this;
  }
  dropColumn(tableName, columnName) {
    this.ops.push({
      type: "DROP_COLUMN",
      tableName: String(tableName),
      columnName: String(columnName)
    });
    return this;
  }
  renameColumn(tableName, from, to) {
    if (String(from) === to) {
      throw new InvalidRenameError("column", String(from), to);
    }
    this.ops.push({
      type: "RENAME_COLUMN",
      tableName: String(tableName),
      from: String(from),
      to
    });
    return this;
  }
  alterColumn(tableName, columnName, newDefinition) {
    this.ops.push({
      type: "ALTER_COLUMN",
      tableName: String(tableName),
      columnName: String(columnName),
      newDefinition
    });
    return this;
  }
  setNotNull(tableName, columnName) {
    this.ops.push({
      type: "SET_NOT_NULL",
      tableName: String(tableName),
      columnName: String(columnName)
    });
    return this;
  }
  dropNotNull(tableName, columnName) {
    this.ops.push({
      type: "DROP_NOT_NULL",
      tableName: String(tableName),
      columnName: String(columnName)
    });
    return this;
  }
  setDefault(tableName, columnName, defaultValue) {
    this.ops.push({
      type: "SET_DEFAULT",
      tableName: String(tableName),
      columnName: String(columnName),
      defaultValue
    });
    return this;
  }
  dropDefault(tableName, columnName) {
    this.ops.push({
      type: "DROP_DEFAULT",
      tableName: String(tableName),
      columnName: String(columnName)
    });
    return this;
  }
  // ----------------------------------------------------------
  //  Index Operations
  // ----------------------------------------------------------
  createIndex(tableName, columns, options) {
    this.ops.push({
      type: "CREATE_INDEX",
      tableName: String(tableName),
      columns: columns.map(String),
      options
    });
    return this;
  }
  dropIndex(indexName, options) {
    this.ops.push({ type: "DROP_INDEX", indexName, options });
    return this;
  }
  // ----------------------------------------------------------
  //  Constraint Operations
  // ----------------------------------------------------------
  addForeignKey(tableName, columnName, references) {
    this.ops.push({
      type: "ADD_FOREIGN_KEY",
      tableName: String(tableName),
      columnName,
      references
    });
    return this;
  }
  dropForeignKey(tableName, constraintName) {
    this.ops.push({
      type: "DROP_FOREIGN_KEY",
      tableName: String(tableName),
      constraintName
    });
    return this;
  }
  addCheck(tableName, constraintName, expression) {
    this.ops.push({
      type: "ADD_CHECK",
      tableName: String(tableName),
      constraintName,
      expression
    });
    return this;
  }
  dropCheck(tableName, constraintName) {
    this.ops.push({
      type: "DROP_CHECK",
      tableName: String(tableName),
      constraintName
    });
    return this;
  }
  // ----------------------------------------------------------
  //  Raw SQL
  // ----------------------------------------------------------
  raw(sql, bindings) {
    const trimmed = sql.trim();
    if (!trimmed) {
      throw new Error("[db-migrate-ts] raw(): SQL string cannot be empty.");
    }
    this.ops.push({ type: "RAW_SQL", sql: trimmed, bindings });
    return this;
  }
  // ----------------------------------------------------------
  //  Compilation & Introspection
  // ----------------------------------------------------------
  /**
   * Returns the collected operations as a readonly array.
   * Used by MigrationRunner and the GUI to inspect operations before compilation.
   */
  getOperations() {
    return this.ops;
  }
  /**
   * Returns a copy of the operations list.
   */
  cloneOperations() {
    return [...this.ops];
  }
  /**
   * Returns true if the builder has no operations.
   */
  isEmpty() {
    return this.ops.length === 0;
  }
  /**
   * Returns the number of operations collected.
   */
  getOperationCount() {
    return this.ops.length;
  }
  /**
   * Clears all collected operations.
   * Useful for resetting the builder in test scenarios.
   */
  clear() {
    this.ops.length = 0;
  }
  /**
   * Returns a human-readable summary of all operations.
   * Used for dry-run output.
   */
  summarize() {
    if (this.ops.length === 0) {
      return "(no operations)";
    }
    return this.ops.map((op, i) => `  ${i + 1}. ${this.describeOp(op)}`).join("\n");
  }
  describeOp(op) {
    switch (op.type) {
      case "CREATE_TABLE":
        return `CREATE TABLE "${op.tableName}" (${Object.keys(op.schema).length} columns)`;
      case "DROP_TABLE":
        return `DROP TABLE "${op.tableName}"${op.options?.cascade ? " CASCADE" : ""}`;
      case "RENAME_TABLE":
        return `RENAME TABLE "${op.from}" \u2192 "${op.to}"`;
      case "TRUNCATE_TABLE":
        return `TRUNCATE TABLE "${op.tableName}"`;
      case "ADD_COLUMN":
        return `ADD COLUMN "${op.tableName}"."${op.columnName}"`;
      case "DROP_COLUMN":
        return `DROP COLUMN "${op.tableName}"."${op.columnName}"`;
      case "RENAME_COLUMN":
        return `RENAME COLUMN "${op.tableName}"."${op.from}" \u2192 "${op.to}"`;
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
        return `ADD FOREIGN KEY "${op.tableName}"."${op.columnName}" \u2192 "${op.references.table}"."${op.references.column}"`;
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
};

// src/migration/migration-tracker.ts
var DEFAULT_MIGRATIONS_TABLE = "_db_migrate_ts_history";
var MigrationTracker = class {
  constructor(adapter, dialect, tableName = DEFAULT_MIGRATIONS_TABLE) {
    this.adapter = adapter;
    this.dialect = dialect;
    this.tableName = tableName;
  }
  adapter;
  dialect;
  tableName;
  // ----------------------------------------------------------
  //  Table Setup
  // ----------------------------------------------------------
  /**
   * Creates the migrations history table if it doesn't already exist.
   * Safe to call multiple times (uses CREATE TABLE IF NOT EXISTS).
   */
  async ensureTable() {
    const sql = this.getCreateTableSQL();
    await this.adapter.execute(sql);
    const indexSQL = this.getCreateIndexSQL();
    await this.adapter.execute(indexSQL);
  }
  getCreateTableSQL() {
    switch (this.dialect) {
      case "postgres":
        return `
          CREATE TABLE IF NOT EXISTS ${this.quote(this.tableName)} (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(500) NOT NULL UNIQUE,
            timestamp   BIGINT NOT NULL,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            checksum    VARCHAR(64) NOT NULL,
            duration_ms INTEGER
          );
        `.trim();
      case "mysql":
        return `
          CREATE TABLE IF NOT EXISTS \`${this.tableName}\` (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            name        VARCHAR(500) NOT NULL UNIQUE,
            timestamp   BIGINT NOT NULL,
            executed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            checksum    VARCHAR(64) NOT NULL,
            duration_ms INT
          );
        `.trim();
      case "sqlite":
        return `
          CREATE TABLE IF NOT EXISTS "${this.tableName}" (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL UNIQUE,
            timestamp   INTEGER NOT NULL,
            executed_at TEXT NOT NULL DEFAULT (datetime('now')),
            checksum    TEXT NOT NULL,
            duration_ms INTEGER
          );
        `.trim();
    }
  }
  getCreateIndexSQL() {
    const indexName = `idx_${this.tableName}_name`;
    switch (this.dialect) {
      case "postgres":
        return `CREATE INDEX IF NOT EXISTS "${indexName}" ON ${this.quote(this.tableName)} (name);`;
      case "mysql":
        return `-- MySQL: unique index on name already created by UNIQUE constraint`;
      case "sqlite":
        return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${this.tableName}" (name);`;
    }
  }
  // ----------------------------------------------------------
  //  CRUD Operations
  // ----------------------------------------------------------
  /**
   * Returns all executed migrations, ordered by timestamp ascending.
   */
  async getExecuted() {
    const rows = await this.adapter.query(
      `SELECT * FROM ${this.quote(this.tableName)} ORDER BY timestamp ASC`
    );
    return rows.map((row) => this.mapRow(row));
  }
  /**
   * Returns the set of executed migration names (for O(1) lookups).
   */
  async getExecutedNames() {
    const executed = await this.getExecuted();
    return new Set(executed.map((m) => m.name));
  }
  /**
   * Records a migration as executed.
   */
  async record(name, timestamp, checksum, durationMs) {
    if (this.dialect === "postgres") {
      await this.adapter.execute(
        `INSERT INTO ${this.quote(this.tableName)} (name, timestamp, checksum, duration_ms)
         VALUES ($1, $2, $3, $4)`,
        [name, timestamp, checksum, durationMs ?? null]
      );
    } else if (this.dialect === "mysql") {
      await this.adapter.execute(
        `INSERT INTO \`${this.tableName}\` (name, timestamp, checksum, duration_ms)
         VALUES (?, ?, ?, ?)`,
        [name, timestamp, checksum, durationMs ?? null]
      );
    } else {
      await this.adapter.execute(
        `INSERT INTO "${this.tableName}" (name, timestamp, checksum, duration_ms)
         VALUES (?, ?, ?, ?)`,
        [name, timestamp, checksum, durationMs ?? null]
      );
    }
  }
  /**
   * Removes a migration record (used during rollback).
   */
  async remove(name) {
    if (this.dialect === "postgres") {
      await this.adapter.execute(
        `DELETE FROM ${this.quote(this.tableName)} WHERE name = $1`,
        [name]
      );
    } else {
      await this.adapter.execute(
        `DELETE FROM ${this.quote(this.tableName)} WHERE name = ?`,
        [name]
      );
    }
  }
  /**
   * Returns a specific migration record by name, or null if not found.
   */
  async getByName(name) {
    let rows;
    if (this.dialect === "postgres") {
      rows = await this.adapter.query(
        `SELECT * FROM ${this.quote(this.tableName)} WHERE name = $1`,
        [name]
      );
    } else {
      rows = await this.adapter.query(
        `SELECT * FROM ${this.quote(this.tableName)} WHERE name = ?`,
        [name]
      );
    }
    return rows[0] ? this.mapRow(rows[0]) : null;
  }
  /**
   * Checks whether a migration has been executed.
   */
  async isExecuted(name) {
    const record = await this.getByName(name);
    return record !== null;
  }
  // ----------------------------------------------------------
  //  Checksum Validation
  // ----------------------------------------------------------
  /**
   * Validates that all executed migrations still match their stored checksums.
   * Detects accidental edits to already-executed migration files.
   *
   * @param migrations - Map of migration name → current checksum
   * @throws ChecksumMismatchError if any checksum has changed
   */
  async validateChecksums(migrations) {
    const executed = await this.getExecuted();
    for (const record of executed) {
      const currentChecksum = migrations.get(record.name);
      if (currentChecksum === void 0) continue;
      if (currentChecksum !== record.checksum) {
        throw new ChecksumMismatchError(record.name, record.checksum, currentChecksum);
      }
    }
  }
  // ----------------------------------------------------------
  //  Table Existence Check
  // ----------------------------------------------------------
  /**
   * Returns true if the migrations history table exists in the database.
   * Used to detect first-run scenarios.
   */
  async tableExists() {
    try {
      if (this.dialect === "postgres") {
        const rows = await this.adapter.query(
          `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = $1
          ) AS exists`,
          [this.tableName]
        );
        return rows[0]?.exists === true;
      } else if (this.dialect === "mysql") {
        const rows = await this.adapter.query(
          `SELECT COUNT(*) as count FROM information_schema.tables
           WHERE table_name = ?`,
          [this.tableName]
        );
        return (rows[0]?.count ?? 0) > 0;
      } else {
        const rows = await this.adapter.query(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          [this.tableName]
        );
        return rows.length > 0;
      }
    } catch {
      return false;
    }
  }
  // ----------------------------------------------------------
  //  Helpers
  // ----------------------------------------------------------
  quote(name) {
    switch (this.dialect) {
      case "postgres":
        return `"${name}"`;
      case "mysql":
        return `\`${name}\``;
      case "sqlite":
        return `"${name}"`;
    }
  }
  mapRow(row) {
    return {
      id: Number(row.id),
      name: String(row.name),
      timestamp: Number(row.timestamp),
      executedAt: row.executed_at instanceof Date ? row.executed_at : new Date(String(row.executed_at)),
      checksum: String(row.checksum),
      durationMs: row.duration_ms != null ? Number(row.duration_ms) : void 0
    };
  }
};
var ZodToSQLConverter = class {
  constructor(dialect) {
    this.dialect = dialect;
  }
  dialect;
  // ----------------------------------------------------------
  //  Public API
  // ----------------------------------------------------------
  /**
   * Returns the full SQL column definition: base type + all constraints.
   */
  convert(definition) {
    const baseType = this.getBaseType(definition);
    const constraints = this.buildConstraints(definition);
    return constraints ? `${baseType} ${constraints}` : baseType;
  }
  /**
   * Returns only the base SQL type string, without any constraints.
   */
  getBaseType(definition) {
    return this.resolveType(definition.schema);
  }
  // ----------------------------------------------------------
  //  Type Resolution
  // ----------------------------------------------------------
  /**
   * Resolves a Zod schema to its SQL base type, unwrapping wrappers first.
   */
  resolveType(schema) {
    const inner = this.unwrap(schema);
    if (inner instanceof z.ZodString) return this.resolveString(inner);
    if (inner instanceof z.ZodNumber) return this.resolveNumber(inner);
    if (inner instanceof z.ZodBigInt) return this.resolveBigInt();
    if (inner instanceof z.ZodBoolean) return this.resolveBoolean();
    if (inner instanceof z.ZodDate) return this.resolveDate();
    if (inner instanceof z.ZodEnum) return this.resolveEnum();
    if (inner instanceof z.ZodNativeEnum) return this.resolveNativeEnum(inner);
    if (inner instanceof z.ZodArray) return this.resolveJson();
    if (inner instanceof z.ZodObject) return this.resolveJson();
    if (inner instanceof z.ZodRecord) return this.resolveJson();
    if (inner instanceof z.ZodUnknown) return "TEXT";
    if (inner instanceof z.ZodAny) return "TEXT";
    if (inner instanceof z.ZodLiteral) return this.resolveLiteral(inner);
    if (inner instanceof z.ZodNull) return "TEXT";
    if (inner instanceof z.ZodUndefined) return "TEXT";
    return "TEXT";
  }
  // ----------------------------------------------------------
  //  String Resolution
  // ----------------------------------------------------------
  resolveString(schema) {
    const checks = schema._def.checks;
    const isUUID = checks.some((c) => c.kind === "uuid");
    if (isUUID) {
      return this.dialect === "postgres" ? "UUID" : "VARCHAR(36)";
    }
    const isCUID = checks.some((c) => c.kind === "cuid" || c.kind === "cuid2");
    if (isCUID) return "VARCHAR(36)";
    const isNanoID = checks.some((c) => c.kind === "nanoid");
    if (isNanoID) return "VARCHAR(21)";
    const isEmail = checks.some((c) => c.kind === "email");
    if (isEmail) return "VARCHAR(254)";
    const isURL = checks.some((c) => c.kind === "url");
    if (isURL) return "TEXT";
    const isIP = checks.some((c) => c.kind === "ip");
    if (isIP) {
      return this.dialect === "postgres" ? "INET" : "VARCHAR(45)";
    }
    const isDatetime = checks.some((c) => c.kind === "datetime");
    if (isDatetime) {
      return this.dialect === "postgres" ? "TIMESTAMPTZ" : "DATETIME";
    }
    const maxCheck = checks.find((c) => c.kind === "max");
    if (maxCheck) {
      const len = maxCheck.value;
      return len <= 65535 ? `VARCHAR(${len})` : "TEXT";
    }
    const lenCheck = checks.find((c) => c.kind === "length");
    if (lenCheck) {
      return this.dialect === "sqlite" ? "TEXT" : `CHAR(${lenCheck.value})`;
    }
    return "TEXT";
  }
  // ----------------------------------------------------------
  //  Number Resolution
  // ----------------------------------------------------------
  resolveNumber(schema) {
    const checks = schema._def.checks;
    const isInt = checks.some((c) => c.kind === "int");
    checks.some((c) => c.kind === "finite");
    if (!isInt) {
      switch (this.dialect) {
        case "postgres":
          return "DOUBLE PRECISION";
        case "mysql":
          return "DOUBLE";
        case "sqlite":
          return "REAL";
      }
    }
    const maxCheck = checks.find((c) => c.kind === "max");
    const minCheck = checks.find((c) => c.kind === "min");
    const needsBigInt = maxCheck && maxCheck.value > 2147483647 || minCheck && minCheck.value < -2147483648;
    if (needsBigInt) {
      return "BIGINT";
    }
    const isSmall = maxCheck && maxCheck.value <= 32767 && (!minCheck || minCheck.value >= -32768);
    if (isSmall) {
      return this.dialect === "postgres" ? "SMALLINT" : "SMALLINT";
    }
    switch (this.dialect) {
      case "postgres":
        return "INTEGER";
      case "mysql":
        return "INT";
      case "sqlite":
        return "INTEGER";
    }
  }
  // ----------------------------------------------------------
  //  Other Type Resolutions
  // ----------------------------------------------------------
  resolveBigInt() {
    return "BIGINT";
  }
  resolveBoolean() {
    switch (this.dialect) {
      case "postgres":
        return "BOOLEAN";
      case "mysql":
        return "TINYINT(1)";
      case "sqlite":
        return "INTEGER";
    }
  }
  resolveDate() {
    switch (this.dialect) {
      case "postgres":
        return "TIMESTAMPTZ";
      case "mysql":
        return "DATETIME";
      case "sqlite":
        return "TEXT";
    }
  }
  resolveEnum() {
    switch (this.dialect) {
      case "postgres":
        return "TEXT";
      case "mysql":
        return "VARCHAR(100)";
      case "sqlite":
        return "TEXT";
    }
  }
  resolveNativeEnum(schema) {
    const values = Object.values(schema.enum);
    const allNumeric = values.every((v) => typeof v === "number");
    if (allNumeric) {
      return this.dialect === "postgres" ? "SMALLINT" : "TINYINT";
    }
    return this.resolveEnum();
  }
  resolveJson() {
    switch (this.dialect) {
      case "postgres":
        return "JSONB";
      case "mysql":
        return "JSON";
      case "sqlite":
        return "TEXT";
    }
  }
  resolveLiteral(schema) {
    const value = schema.value;
    if (typeof value === "number") return this.dialect === "postgres" ? "INTEGER" : "INT";
    if (typeof value === "boolean") return this.resolveBoolean();
    return "TEXT";
  }
  // ----------------------------------------------------------
  //  Unwrapping
  // ----------------------------------------------------------
  /**
   * Recursively unwraps Zod wrapper types to reach the core type.
   * Handles: ZodOptional, ZodNullable, ZodDefault, ZodEffects, ZodBranded.
   */
  unwrap(schema) {
    if (schema instanceof z.ZodOptional) {
      return this.unwrap(schema.unwrap());
    }
    if (schema instanceof z.ZodNullable) {
      return this.unwrap(schema.unwrap());
    }
    if (schema instanceof z.ZodDefault) {
      return this.unwrap(schema._def.innerType);
    }
    if (schema instanceof z.ZodEffects) {
      return this.unwrap(schema.innerType());
    }
    if ("_def" in schema && schema._def && typeof schema._def === "object") {
      const def = schema._def;
      if (def.typeName === "ZodBranded" && def.type) {
        return this.unwrap(def.type);
      }
    }
    return schema;
  }
  // ----------------------------------------------------------
  //  Nullability Detection
  // ----------------------------------------------------------
  /**
   * Determines whether a column definition allows NULL values.
   * Checks both explicit nullable flag and Zod wrapper types.
   */
  isNullable(definition) {
    if (definition.nullable === true) return true;
    if (definition.nullable === false) return false;
    const schema = definition.schema;
    if (schema instanceof z.ZodOptional) return true;
    if (schema instanceof z.ZodNullable) return true;
    return false;
  }
  // ----------------------------------------------------------
  //  Constraint Building
  // ----------------------------------------------------------
  /**
   * Builds the constraint string to append after the base type.
   * e.g. "NOT NULL PRIMARY KEY DEFAULT 'guest'"
   */
  buildConstraints(definition) {
    const parts = [];
    if (!this.isNullable(definition)) {
      parts.push("NOT NULL");
    }
    if (definition.primaryKey) {
      parts.push("PRIMARY KEY");
    }
    if (definition.unique && !definition.primaryKey) {
      parts.push("UNIQUE");
    }
    if (definition.default !== void 0) {
      parts.push(`DEFAULT ${this.formatDefault(definition.default, definition.schema)}`);
    }
    if (definition.references) {
      const ref = definition.references;
      let fk = `REFERENCES ${this.quoteIdent(ref.table)}(${this.quoteIdent(ref.column)})`;
      if (ref.onDelete) fk += ` ON DELETE ${ref.onDelete}`;
      if (ref.onUpdate) fk += ` ON UPDATE ${ref.onUpdate}`;
      parts.push(fk);
    }
    if (definition.checks?.length) {
      for (const check of definition.checks) {
        parts.push(`CONSTRAINT ${this.quoteIdent(check.name)} CHECK (${check.expression})`);
      }
    }
    return parts.join(" ");
  }
  /**
   * Formats a default value as a SQL literal.
   */
  formatDefault(value, schema) {
    if (typeof value === "string" && (value.includes("(") || value.toUpperCase() === value)) {
      return value;
    }
    if (value === null) return "NULL";
    if (typeof value === "boolean") {
      const inner = this.unwrap(schema);
      if (inner instanceof z.ZodBoolean) {
        switch (this.dialect) {
          case "postgres":
            return value ? "TRUE" : "FALSE";
          case "mysql":
            return value ? "1" : "0";
          case "sqlite":
            return value ? "1" : "0";
        }
      }
    }
    if (typeof value === "number") return String(value);
    if (typeof value === "bigint") return String(value);
    if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }
    if (typeof value === "object") {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
    return String(value);
  }
  /**
   * Quotes an identifier (table/column name) for the current dialect.
   */
  quoteIdent(name) {
    switch (this.dialect) {
      case "postgres":
        return `"${name.replace(/"/g, '""')}"`;
      case "mysql":
        return `\`${name.replace(/`/g, "``")}\``;
      case "sqlite":
        return `"${name.replace(/"/g, '""')}"`;
    }
  }
};
function computeChecksum(content) {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}
function computeMigrationChecksum(migration) {
  const content = migration.up.toString() + "||" + migration.down.toString();
  return computeChecksum(content);
}
function computeIndexNameHash(tableName, columns) {
  const content = tableName + ":" + columns.sort().join(",");
  return createHash("md5").update(content).digest("hex").slice(0, 8);
}

// src/types/dialect.types.ts
var DIALECT_FEATURES = {
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
    alterColumnType: true
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
    alterColumnType: true
  },
  sqlite: {
    jsonb: false,
    uuid: false,
    enumTypes: false,
    partialIndexes: true,
    concurrentIndexes: false,
    returning: true,
    // SQLite >= 3.35.0
    generatedColumns: true,
    // SQLite >= 3.31.0
    schemas: false,
    advisoryLocks: false,
    columnComments: false,
    multipleSchemas: false,
    renameColumn: true,
    // SQLite >= 3.25.0
    dropColumn: true,
    // SQLite >= 3.35.0
    alterColumnType: false
    // SQLite doesn't support ALTER COLUMN TYPE
  }
};

// src/sql/sql-builder.ts
var SqlBuilder = class {
  constructor(dialect) {
    this.dialect = dialect;
    this.converter = new ZodToSQLConverter(dialect);
    this.features = DIALECT_FEATURES[dialect];
  }
  dialect;
  converter;
  features;
  /**
   * Compiles an array of MigrationOperations to SQL strings.
   * Returns one SQL string per operation (some operations may expand to multiple statements).
   */
  compile(operations) {
    const statements = [];
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
  compileOp(op) {
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
  createTable(tableName, schema) {
    const q = this.q.bind(this);
    const columnDefs = Object.entries(schema).map(([colName, def]) => {
      const colSQL = this.converter.convert(def);
      return `  ${q(colName)} ${colSQL}`;
    });
    const fkConstraints = Object.entries(schema).filter(([, def]) => def.references).map(([colName, def]) => {
      const ref = def.references;
      let fk = `  CONSTRAINT ${q(`fk_${tableName}_${colName}`)} FOREIGN KEY (${q(colName)}) REFERENCES ${q(ref.table)} (${q(ref.column)})`;
      if (ref.onDelete) fk += ` ON DELETE ${ref.onDelete}`;
      if (ref.onUpdate) fk += ` ON UPDATE ${ref.onUpdate}`;
      return fk;
    });
    const allDefs = this.dialect === "sqlite" ? columnDefs : [...columnDefs, ...fkConstraints];
    const body = allDefs.join(",\n");
    return `CREATE TABLE ${q(tableName)} (
${body}
)`;
  }
  // ----------------------------------------------------------
  //  DROP TABLE
  // ----------------------------------------------------------
  dropTable(tableName, options) {
    const q = this.q.bind(this);
    const ifExists = options?.ifExists ? "IF EXISTS " : "";
    const cascade = options?.cascade ? " CASCADE" : "";
    return `DROP TABLE ${ifExists}${q(tableName)}${cascade}`;
  }
  // ----------------------------------------------------------
  //  RENAME TABLE
  // ----------------------------------------------------------
  renameTable(from, to) {
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
  truncateTable(tableName) {
    const q = this.q.bind(this);
    switch (this.dialect) {
      case "postgres":
        return `TRUNCATE TABLE ${q(tableName)} RESTART IDENTITY`;
      case "mysql":
        return `TRUNCATE TABLE ${q(tableName)}`;
      case "sqlite":
        return `DELETE FROM ${q(tableName)}`;
    }
  }
  // ----------------------------------------------------------
  //  ADD COLUMN
  // ----------------------------------------------------------
  addColumn(tableName, columnName, definition) {
    const q = this.q.bind(this);
    const colSQL = this.converter.convert(definition);
    return `ALTER TABLE ${q(tableName)} ADD COLUMN ${q(columnName)} ${colSQL}`;
  }
  // ----------------------------------------------------------
  //  DROP COLUMN
  // ----------------------------------------------------------
  dropColumn(tableName, columnName) {
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
  renameColumn(tableName, from, to) {
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
  alterColumn(tableName, columnName, newDefinition) {
    const q = this.q.bind(this);
    if (!this.features.alterColumnType && this.dialect === "sqlite") {
      throw new UnsupportedDialectOperationError(
        "alterColumn",
        "sqlite",
        "SQLite does not support ALTER COLUMN TYPE. You must recreate the table. Use migrate.raw() with the required SQLite table recreation SQL."
      );
    }
    const colSQL = this.converter.convert(newDefinition);
    switch (this.dialect) {
      case "postgres":
        return [
          `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} TYPE ${this.converter.getBaseType(newDefinition)}`,
          ...newDefinition.nullable === false ? [`ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} SET NOT NULL`] : [`ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} DROP NOT NULL`],
          ...newDefinition.default !== void 0 ? [
            `ALTER TABLE ${q(tableName)} ALTER COLUMN ${q(columnName)} SET DEFAULT ${typeof newDefinition.default === "string" ? `'${newDefinition.default}'` : String(newDefinition.default)}`
          ] : []
        ];
      case "mysql":
        return `ALTER TABLE ${q(tableName)} MODIFY COLUMN ${q(columnName)} ${colSQL}`;
      case "sqlite":
        throw new UnsupportedDialectOperationError("alterColumn", "sqlite");
    }
  }
  // ----------------------------------------------------------
  //  SET / DROP NOT NULL
  // ----------------------------------------------------------
  setNotNull(tableName, columnName) {
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
  dropNotNull(tableName, columnName) {
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
  setDefault(tableName, columnName, defaultValue) {
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
  dropDefault(tableName, columnName) {
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
  createIndex(tableName, columns, options) {
    const q = this.q.bind(this);
    const indexName = options?.name ?? `idx_${tableName}_${computeIndexNameHash(tableName, columns)}`;
    const unique = options?.unique ? "UNIQUE " : "";
    const concurrent = options?.concurrently && this.features.concurrentIndexes ? "CONCURRENTLY " : "";
    const using = options?.using && this.features.partialIndexes ? ` USING ${options.using.toUpperCase()}` : "";
    const where = options?.where && this.features.partialIndexes ? ` WHERE ${options.where}` : "";
    const cols = columns.map((c) => q(c)).join(", ");
    return `CREATE ${unique}INDEX ${concurrent}${q(indexName)} ON ${q(tableName)}${using} (${cols})${where}`;
  }
  // ----------------------------------------------------------
  //  DROP INDEX
  // ----------------------------------------------------------
  dropIndex(indexName, options) {
    const q = this.q.bind(this);
    const ifExists = options?.ifExists ? "IF EXISTS " : "";
    const concurrent = options?.concurrently && this.features.concurrentIndexes ? "CONCURRENTLY " : "";
    const cascade = options?.cascade ? " CASCADE" : "";
    switch (this.dialect) {
      case "postgres":
        return `DROP INDEX ${concurrent}${ifExists}${q(indexName)}${cascade}`;
      case "mysql":
        return `DROP INDEX ${q(indexName)} ON ${q("__TABLE__")}`;
      case "sqlite":
        return `DROP INDEX ${ifExists}${q(indexName)}`;
    }
  }
  // ----------------------------------------------------------
  //  FOREIGN KEY CONSTRAINTS
  // ----------------------------------------------------------
  addForeignKey(tableName, columnName, refs) {
    const q = this.q.bind(this);
    const constraintName = refs.name ?? `fk_${tableName}_${columnName}`;
    let sql = `ALTER TABLE ${q(tableName)} ADD CONSTRAINT ${q(constraintName)} FOREIGN KEY (${q(columnName)}) REFERENCES ${q(refs.table)} (${q(refs.column)})`;
    if (refs.onDelete) sql += ` ON DELETE ${refs.onDelete}`;
    if (refs.onUpdate) sql += ` ON UPDATE ${refs.onUpdate}`;
    return sql;
  }
  dropForeignKey(tableName, constraintName) {
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
  addCheck(tableName, constraintName, expression) {
    const q = this.q.bind(this);
    return `ALTER TABLE ${q(tableName)} ADD CONSTRAINT ${q(constraintName)} CHECK (${expression})`;
  }
  dropCheck(tableName, constraintName) {
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
  q(name) {
    switch (this.dialect) {
      case "postgres":
        return `"${name.replace(/"/g, '""')}"`;
      case "mysql":
        return `\`${name.replace(/`/g, "``")}\``;
      case "sqlite":
        return `"${name.replace(/"/g, '""')}"`;
    }
  }
  formatDefault(value) {
    if (value === null) return "NULL";
    if (typeof value === "string") {
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
};
var LEVEL_ORDER = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  success: 1,
  silent: 999
};
var Logger = class {
  level;
  prefix;
  timestamps;
  constructor(options = {}) {
    this.level = options.level ?? "info";
    this.prefix = options.prefix ?? "";
    this.timestamps = options.timestamps ?? false;
  }
  shouldLog(level) {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }
  formatMessage(level, message) {
    const parts = [];
    if (this.timestamps) {
      parts.push(chalk2.gray((/* @__PURE__ */ new Date()).toISOString()));
    }
    if (this.prefix) {
      parts.push(chalk2.cyan(`[${this.prefix}]`));
    }
    switch (level) {
      case "debug":
        parts.push(chalk2.gray("[DEBUG]"), chalk2.gray(message));
        break;
      case "info":
        parts.push(chalk2.blue("[INFO]"), chalk2.white(message));
        break;
      case "warn":
        parts.push(chalk2.yellow("[WARN]"), chalk2.yellow(message));
        break;
      case "error":
        parts.push(chalk2.red("[ERROR]"), chalk2.red(message));
        break;
      case "success":
        parts.push(chalk2.green("[OK]"), chalk2.green(message));
        break;
    }
    return parts.join(" ");
  }
  debug(message, ...args) {
    if (this.shouldLog("debug")) {
      console.log(this.formatMessage("debug", message), ...args);
    }
  }
  info(message, ...args) {
    if (this.shouldLog("info")) {
      console.log(this.formatMessage("info", message), ...args);
    }
  }
  warn(message, ...args) {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message), ...args);
    }
  }
  error(message, ...args) {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message), ...args);
    }
  }
  success(message, ...args) {
    if (this.shouldLog("success")) {
      console.log(this.formatMessage("success", message), ...args);
    }
  }
  /** Prints a blank line */
  blank() {
    if (this.level !== "silent") {
      console.log();
    }
  }
  /** Prints a horizontal divider */
  divider(char = "\u2500", width = 60) {
    if (this.level !== "silent") {
      console.log(chalk2.gray(char.repeat(width)));
    }
  }
  /** Prints a migration status line (for the status command table) */
  table(rows) {
    if (this.level === "silent" || rows.length === 0) return;
    const headers = Object.keys(rows[0] ?? {});
    const widths = headers.map(
      (h) => Math.max(h.length, ...rows.map((r) => String(r[h] ?? "").length))
    );
    const header = headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join("  ");
    const divider = widths.map((w) => "\u2500".repeat(w)).join("  ");
    console.log(chalk2.bold.white(header));
    console.log(chalk2.gray(divider));
    for (const row of rows) {
      const line = headers.map((h, i) => String(row[h] ?? "").padEnd(widths[i] ?? 0)).join("  ");
      console.log(line);
    }
  }
};
var defaultLogger = new Logger({ prefix: "db-migrate-ts" });
function createLogger(options) {
  return new Logger(options);
}
var MigrationRunner = class {
  constructor(adapter, optionsOrDialect) {
    this.adapter = adapter;
    const opts = typeof optionsOrDialect === "string" ? { dialect: optionsOrDialect } : optionsOrDialect;
    this.options = {
      dialect: opts.dialect,
      migrationsTable: opts.migrationsTable ?? "_db_migrate_ts_history",
      validateChecksums: opts.validateChecksums ?? true,
      saveSQLSnapshots: opts.saveSQLSnapshots ?? false,
      snapshotsDir: opts.snapshotsDir ?? "./migrations/snapshots",
      dryRun: opts.dryRun ?? false
    };
    this.tracker = new MigrationTracker(
      adapter,
      opts.dialect,
      this.options.migrationsTable
    );
    this.sqlBuilder = new SqlBuilder(opts.dialect);
    this.logger = opts.logger ? createLogger() : createLogger({ prefix: "db-migrate-ts" });
  }
  adapter;
  tracker;
  sqlBuilder;
  logger;
  options;
  // ----------------------------------------------------------
  //  UP — Apply pending migrations
  // ----------------------------------------------------------
  /**
   * Runs all pending migrations in ascending timestamp order.
   * Each migration is wrapped in a database transaction.
   *
   * @param migrations - Complete list of all migration definitions
   * @param limit      - Optional: run at most N pending migrations
   */
  async up(migrations, limit) {
    await this.tracker.ensureTable();
    const executedNames = await this.tracker.getExecutedNames();
    const checksumMap = new Map(
      migrations.map((m) => [m.name, computeMigrationChecksum(m)])
    );
    if (this.options.validateChecksums) {
      await this.tracker.validateChecksums(checksumMap);
    }
    const pending = migrations.filter((m) => !executedNames.has(m.name)).sort((a, b) => a.timestamp - b.timestamp).slice(0, limit);
    if (pending.length === 0) {
      this.logger.success("Database is already up to date. No pending migrations.");
      return { applied: [], rolledBack: [], dryRun: this.options.dryRun };
    }
    this.logger.info(
      `Found ${pending.length} pending migration${pending.length === 1 ? "" : "s"}. Running...`
    );
    this.logger.blank();
    const applied = [];
    for (const migration of pending) {
      await this.runMigrationUp(migration, checksumMap.get(migration.name));
      applied.push(migration.name);
    }
    this.logger.blank();
    this.logger.success(
      `\u2705 ${applied.length} migration${applied.length === 1 ? "" : "s"} applied successfully.`
    );
    return { applied, rolledBack: [], dryRun: this.options.dryRun };
  }
  // ----------------------------------------------------------
  //  DOWN — Rollback migrations
  // ----------------------------------------------------------
  /**
   * Rolls back the last N executed migrations (default: 1).
   *
   * @param migrations - Complete list of all migration definitions
   * @param steps      - Number of migrations to roll back (default: 1)
   */
  async down(migrations, steps = 1) {
    await this.tracker.ensureTable();
    const executed = await this.tracker.getExecuted();
    const toRollback = executed.sort((a, b) => b.timestamp - a.timestamp).slice(0, steps);
    if (toRollback.length === 0) {
      this.logger.warn("No migrations to rollback.");
      return { applied: [], rolledBack: [], dryRun: this.options.dryRun };
    }
    this.logger.info(
      `Rolling back ${toRollback.length} migration${toRollback.length === 1 ? "" : "s"}...`
    );
    this.logger.blank();
    const rolledBack = [];
    for (const record of toRollback) {
      const migration = migrations.find((m) => m.name === record.name);
      if (!migration) {
        throw new Error(
          `[db-migrate-ts] Cannot rollback "${record.name}" \u2014 migration file not found. If you deleted the file intentionally, remove the record manually:
  DELETE FROM ${this.options.migrationsTable} WHERE name = '${record.name}'`
        );
      }
      await this.runMigrationDown(migration, record);
      rolledBack.push(record.name);
    }
    this.logger.blank();
    this.logger.success(
      `\u2705 ${rolledBack.length} migration${rolledBack.length === 1 ? "" : "s"} rolled back.`
    );
    return { applied: [], rolledBack, dryRun: this.options.dryRun };
  }
  // ----------------------------------------------------------
  //  STATUS — Report migration state
  // ----------------------------------------------------------
  /**
   * Returns the status of all migrations (pending/executed/unknown).
   *
   * @param migrations - Complete list of all migration definitions
   */
  async status(migrations) {
    await this.tracker.ensureTable();
    const executed = await this.tracker.getExecuted();
    const executedMap = new Map(executed.map((r) => [r.name, r]));
    const fileEntries = migrations.sort((a, b) => a.timestamp - b.timestamp).map((m) => {
      const record = executedMap.get(m.name);
      if (record) {
        const currentChecksum = computeMigrationChecksum(m);
        const checksumValid = currentChecksum === record.checksum;
        return {
          name: m.name,
          timestamp: m.timestamp,
          status: "executed",
          executedAt: record.executedAt,
          durationMs: record.durationMs,
          checksumValid
        };
      }
      return {
        name: m.name,
        timestamp: m.timestamp,
        status: "pending"
      };
    });
    const fileNames = new Set(migrations.map((m) => m.name));
    const orphanEntries = executed.filter((r) => !fileNames.has(r.name)).map((r) => ({
      name: r.name,
      timestamp: r.timestamp,
      status: "skipped",
      executedAt: r.executedAt
    }));
    return [...fileEntries, ...orphanEntries];
  }
  // ----------------------------------------------------------
  //  Internal Migration Execution
  // ----------------------------------------------------------
  /**
   * Runs a single migration's `up` function inside a transaction.
   */
  async runMigrationUp(migration, checksum) {
    const name = migration.name;
    process.stdout.write(`  ${chalk2.gray("\u2192")} ${chalk2.white(name)}  `);
    const builder = new MigrationBuilderImpl(this.options.dialect);
    let durationMs;
    try {
      await migration.up(builder);
      const statements = this.sqlBuilder.compile(builder.getOperations());
      if (this.options.dryRun) {
        process.stdout.write(chalk2.yellow("(dry run)\n"));
        console.log(chalk2.gray("    SQL:"));
        statements.forEach((sql) => console.log(chalk2.gray(`      ${sql}`)));
        return;
      }
      if (this.options.saveSQLSnapshots && statements.length > 0) {
        await this.saveSnapshot(name, "up", statements);
      }
      const startTime = Date.now();
      await this.adapter.transaction(async () => {
        for (const sql of statements) {
          await this.adapter.execute(sql);
        }
        await this.tracker.record(name, migration.timestamp, checksum, void 0);
      });
      durationMs = Date.now() - startTime;
      process.stdout.write(chalk2.green("\u2713") + chalk2.gray(` (${durationMs}ms)
`));
    } catch (error) {
      process.stdout.write(chalk2.red("\u2717\n"));
      throw new MigrationExecutionError(
        name,
        "up",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  /**
   * Runs a single migration's `down` function inside a transaction.
   */
  async runMigrationDown(migration, record) {
    const name = migration.name;
    process.stdout.write(`  ${chalk2.gray("\u2190")} ${chalk2.white(name)}  `);
    const builder = new MigrationBuilderImpl(this.options.dialect);
    try {
      await migration.down(builder);
      const statements = this.sqlBuilder.compile(builder.getOperations());
      if (this.options.dryRun) {
        process.stdout.write(chalk2.yellow("(dry run)\n"));
        console.log(chalk2.gray("    SQL:"));
        statements.forEach((sql) => console.log(chalk2.gray(`      ${sql}`)));
        return;
      }
      if (this.options.saveSQLSnapshots && statements.length > 0) {
        await this.saveSnapshot(name, "down", statements);
      }
      const startTime = Date.now();
      await this.adapter.transaction(async () => {
        for (const sql of statements) {
          await this.adapter.execute(sql);
        }
        await this.tracker.remove(record.name);
      });
      const durationMs = Date.now() - startTime;
      process.stdout.write(chalk2.green("\u2713") + chalk2.gray(` (${durationMs}ms)
`));
    } catch (error) {
      process.stdout.write(chalk2.red("\u2717\n"));
      throw new MigrationExecutionError(
        name,
        "down",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  // ----------------------------------------------------------
  //  SQL Snapshot Saving
  // ----------------------------------------------------------
  async saveSnapshot(migrationName, direction, statements) {
    try {
      await mkdir(this.options.snapshotsDir, { recursive: true });
      const filename = `${migrationName}.${direction}.snapshot.sql`;
      const filepath = join(this.options.snapshotsDir, filename);
      const content = [
        `-- Snapshot: ${migrationName} (${direction})`,
        `-- Generated: ${(/* @__PURE__ */ new Date()).toISOString()}`,
        `-- Dialect: ${this.options.dialect}`,
        "",
        ...statements.map((s) => s + ";"),
        ""
      ].join("\n");
      await writeFile(filepath, content, "utf-8");
    } catch {
      this.logger.warn(`Could not save SQL snapshot for "${migrationName}"`);
    }
  }
};

// src/migration/rollback-manager.ts
var RollbackManager = class {
  constructor(adapter, allMigrations, dialect, migrationsTable) {
    this.adapter = adapter;
    this.allMigrations = allMigrations;
    this.dialect = dialect;
    this.migrationsTable = migrationsTable;
    this.tracker = new MigrationTracker(adapter, dialect, migrationsTable);
    this.runner = new MigrationRunner(adapter, { dialect, migrationsTable });
  }
  adapter;
  allMigrations;
  dialect;
  migrationsTable;
  tracker;
  runner;
  // ----------------------------------------------------------
  //  Roll back to specific migration
  // ----------------------------------------------------------
  /**
   * Rolls back all migrations executed AFTER the given target migration name.
   * The target migration itself is NOT rolled back.
   *
   * @param targetName - Roll back everything after this migration
   *
   * @example
   * // Timeline: A → B → C → D (all executed)
   * await manager.rollbackTo("B");
   * // Result: A → B (C and D rolled back)
   */
  async rollbackTo(targetName) {
    const executed = await this.tracker.getExecuted();
    const sortedDesc = [...executed].sort((a, b) => b.timestamp - a.timestamp);
    const targetIdx = sortedDesc.findIndex((r) => r.name === targetName);
    if (targetIdx === -1) {
      throw new Error(
        `[db-migrate-ts] rollbackTo: Migration "${targetName}" has not been executed. It cannot be used as a rollback target.`
      );
    }
    const toRollback = sortedDesc.slice(0, targetIdx);
    if (toRollback.length === 0) {
      return [];
    }
    const result = await this.runner.down(this.allMigrations, toRollback.length);
    return result.rolledBack;
  }
  // ----------------------------------------------------------
  //  Roll back to specific timestamp
  // ----------------------------------------------------------
  /**
   * Rolls back all migrations with a timestamp > the given value.
   *
   * @param timestamp - Numeric timestamp (YYYYMMDDHHMMSS format)
   *
   * @example
   * await manager.rollbackToTimestamp(20241215120000);
   * // Rolls back all migrations applied after December 15, 2024 at 12:00:00
   */
  async rollbackToTimestamp(timestamp) {
    const executed = await this.tracker.getExecuted();
    const toRollback = executed.filter((r) => r.timestamp > timestamp).sort((a, b) => b.timestamp - a.timestamp);
    if (toRollback.length === 0) {
      return [];
    }
    const result = await this.runner.down(this.allMigrations, toRollback.length);
    return result.rolledBack;
  }
  // ----------------------------------------------------------
  //  Roll back everything
  // ----------------------------------------------------------
  /**
   * Rolls back ALL executed migrations (complete database reset).
   *
   * ⚠️ WARNING: This is a destructive operation that drops all your tables!
   * Use only in development/testing environments.
   */
  async rollbackAll() {
    const executed = await this.tracker.getExecuted();
    if (executed.length === 0) {
      return [];
    }
    const result = await this.runner.down(this.allMigrations, executed.length);
    return result.rolledBack;
  }
  // ----------------------------------------------------------
  //  Preview — what would be rolled back
  // ----------------------------------------------------------
  /**
   * Returns a preview of migrations that would be rolled back
   * without actually executing anything.
   *
   * @param targetName - Target migration name (same as rollbackTo)
   */
  async preview(targetName) {
    const executed = await this.tracker.getExecuted();
    const sortedDesc = [...executed].sort((a, b) => b.timestamp - a.timestamp);
    const targetIdx = sortedDesc.findIndex((r) => r.name === targetName);
    if (targetIdx === -1) return [];
    const toRollbackNames = new Set(sortedDesc.slice(0, targetIdx).map((r) => r.name));
    return this.allMigrations.filter((m) => toRollbackNames.has(m.name));
  }
  // ----------------------------------------------------------
  //  Status Query
  // ----------------------------------------------------------
  /**
   * Returns the most recently executed migration.
   */
  async getLastExecuted() {
    const executed = await this.tracker.getExecuted();
    if (executed.length === 0) return null;
    const last = [...executed].sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!last) return null;
    return this.allMigrations.find((m) => m.name === last.name) ?? null;
  }
  /**
   * Returns the number of pending migrations (not yet executed).
   */
  async getPendingCount() {
    const executedNames = await this.tracker.getExecutedNames();
    return this.allMigrations.filter((m) => !executedNames.has(m.name)).length;
  }
};

// src/dialects/base.dialect.ts
var BaseDialectAdapter = class {
  /**
   * Default ping implementation — runs a trivial query.
   * Override if the database has a dedicated health check command.
   */
  async ping() {
    try {
      await this.execute("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Default version implementation.
   * Override for dialect-specific version queries.
   */
  async getVersion() {
    try {
      const rows = await this.query("SELECT version()");
      return rows[0]?.version ?? "unknown";
    } catch {
      return "unknown";
    }
  }
  /**
   * Wraps a driver error with more context.
   */
  wrapError(operation, original) {
    const msg = original instanceof Error ? original.message : String(original);
    return new Error(
      `[db-migrate-ts] ${this.dialect} adapter error during ${operation}: ${msg}`
    );
  }
};

// src/dialects/postgres.dialect.ts
var PostgresAdapter = class extends BaseDialectAdapter {
  constructor(pool) {
    super();
    this.pool = pool;
  }
  pool;
  dialect = "postgres";
  /** Active client during a transaction (null outside transactions) */
  transactionClient = null;
  /** Tracks savepoint depth for nested transactions */
  savepointDepth = 0;
  // ----------------------------------------------------------
  //  Core Interface
  // ----------------------------------------------------------
  async execute(sql, params) {
    const client = this.transactionClient ?? this.pool;
    try {
      await client.query(sql, params ?? []);
    } catch (error) {
      throw this.wrapError(`execute("${sql.slice(0, 60)}")`, error);
    }
  }
  async query(sql, params) {
    const client = this.transactionClient ?? this.pool;
    try {
      const result = await client.query(sql, params ?? []);
      return result.rows;
    } catch (error) {
      throw this.wrapError(`query("${sql.slice(0, 60)}")`, error);
    }
  }
  async transaction(fn) {
    if (!this.transactionClient) {
      return this.runTopLevelTransaction(fn);
    }
    return this.runNestedTransaction(fn);
  }
  async close() {
    await this.pool.end();
  }
  // ----------------------------------------------------------
  //  PostgreSQL-specific features
  // ----------------------------------------------------------
  /**
   * Acquires an advisory lock to prevent concurrent migration runs.
   * Uses PostgreSQL's advisory locking mechanism.
   *
   * @param lockId - A unique numeric lock identifier (e.g., hash of "db-migrate-ts")
   * @returns true if the lock was acquired, false if it's already held
   */
  async tryAdvisoryLock(lockId = 78549378) {
    const rows = await this.query(
      "SELECT pg_try_advisory_lock($1) AS result",
      [lockId]
    );
    return rows[0]?.result === true;
  }
  /**
   * Releases a previously acquired advisory lock.
   */
  async releaseAdvisoryLock(lockId = 78549378) {
    await this.execute("SELECT pg_advisory_unlock($1)", [lockId]);
  }
  /**
   * Returns the PostgreSQL server version as a semver string.
   *
   * @example
   * await adapter.getVersion(); // → "16.1"
   */
  async getVersion() {
    const rows = await this.query("SHOW server_version");
    return rows[0]?.version ?? "unknown";
  }
  /**
   * Returns the list of tables in the public schema.
   */
  async listTables() {
    const rows = await this.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    return rows.map((r) => r.table_name);
  }
  // ----------------------------------------------------------
  //  Internal transaction helpers
  // ----------------------------------------------------------
  async runTopLevelTransaction(fn) {
    this.transactionClient = await this.pool.connect();
    try {
      await this.transactionClient.query("BEGIN");
      const result = await fn();
      await this.transactionClient.query("COMMIT");
      return result;
    } catch (error) {
      await this.transactionClient.query("ROLLBACK").catch(() => void 0);
      throw error;
    } finally {
      this.transactionClient.release();
      this.transactionClient = null;
    }
  }
  async runNestedTransaction(fn) {
    const savepointName = `sp_${++this.savepointDepth}`;
    try {
      await this.execute(`SAVEPOINT ${savepointName}`);
      const result = await fn();
      await this.execute(`RELEASE SAVEPOINT ${savepointName}`);
      return result;
    } catch (error) {
      await this.execute(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => void 0);
      throw error;
    } finally {
      this.savepointDepth--;
    }
  }
};
async function createPostgresAdapter(connectionString) {
  let Pool;
  try {
    const pg = await import('pg');
    Pool = pg.Pool ?? pg.default.Pool;
  } catch {
    throw new Error(
      '[db-migrate-ts] PostgreSQL adapter requires the "pg" package.\nInstall it with: npm install pg @types/pg'
    );
  }
  const pool = new Pool({ connectionString });
  return new PostgresAdapter(pool);
}

// src/dialects/mysql.dialect.ts
var MySQLAdapter = class extends BaseDialectAdapter {
  constructor(pool) {
    super();
    this.pool = pool;
  }
  pool;
  dialect = "mysql";
  /** Active connection during a transaction */
  transactionConnection = null;
  // ----------------------------------------------------------
  //  Core Interface
  // ----------------------------------------------------------
  async execute(sql, params) {
    const client = this.transactionConnection ?? this.pool;
    try {
      await client.execute(sql, params ?? []);
    } catch (error) {
      throw this.wrapError(`execute("${sql.slice(0, 60)}")`, error);
    }
  }
  async query(sql, params) {
    const client = this.transactionConnection ?? this.pool;
    try {
      const [rows] = await client.execute(
        sql,
        params ?? []
      );
      return rows;
    } catch (error) {
      throw this.wrapError(`query("${sql.slice(0, 60)}")`, error);
    }
  }
  async transaction(fn) {
    this.transactionConnection = await this.pool.getConnection();
    try {
      await this.transactionConnection.beginTransaction();
      const result = await fn();
      await this.transactionConnection.commit();
      return result;
    } catch (error) {
      await this.transactionConnection.rollback().catch(() => void 0);
      throw error;
    } finally {
      this.transactionConnection.release();
      this.transactionConnection = null;
    }
  }
  async close() {
    await this.pool.end();
  }
  // ----------------------------------------------------------
  //  MySQL-specific features
  // ----------------------------------------------------------
  /**
   * Acquires a named MySQL lock to prevent concurrent migration runs.
   *
   * @param lockName - Lock name (string, up to 64 chars)
   * @param timeout  - Wait timeout in seconds (0 = fail immediately)
   */
  async tryNamedLock(lockName = "db-migrate-ts", timeout = 0) {
    const rows = await this.query(
      "SELECT GET_LOCK(?, ?) AS result",
      [lockName, timeout]
    );
    return rows[0]?.result === 1;
  }
  /**
   * Releases a named MySQL lock.
   */
  async releaseNamedLock(lockName = "db-migrate-ts") {
    await this.execute("SELECT RELEASE_LOCK(?)", [lockName]);
  }
  /**
   * Returns the MySQL/MariaDB server version.
   */
  async getVersion() {
    const rows = await this.query("SELECT VERSION()");
    return rows[0]?.["VERSION()"] ?? "unknown";
  }
  /**
   * Returns the list of tables in the current database.
   */
  async listTables() {
    const rows = await this.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`
    );
    return rows.map((r) => r.TABLE_NAME);
  }
};
async function createMySQLAdapter(uri) {
  let createPool;
  try {
    const mysql2 = await import('mysql2/promise');
    createPool = mysql2.createPool;
  } catch {
    throw new Error(
      '[db-migrate-ts] MySQL adapter requires the "mysql2" package.\nInstall it with: npm install mysql2'
    );
  }
  const pool = createPool({ uri });
  return new MySQLAdapter(pool);
}

// src/dialects/sqlite.dialect.ts
var SQLiteAdapter = class extends BaseDialectAdapter {
  constructor(db) {
    super();
    this.db = db;
  }
  db;
  dialect = "sqlite";
  /** Whether we're currently inside a transaction */
  inTransaction = false;
  // ----------------------------------------------------------
  //  Core Interface
  // ----------------------------------------------------------
  async execute(sql, params) {
    try {
      this.db.prepare(sql).run(...params ?? []);
    } catch (error) {
      throw this.wrapError(`execute("${sql.slice(0, 60)}")`, error);
    }
  }
  async query(sql, params) {
    try {
      const rows = this.db.prepare(sql).all(...params ?? []);
      return rows;
    } catch (error) {
      throw this.wrapError(`query("${sql.slice(0, 60)}")`, error);
    }
  }
  /**
   * better-sqlite3 transactions are synchronous.
   * We wrap them in a Promise to conform to the async interface.
   */
  async transaction(fn) {
    if (this.inTransaction) {
      return fn();
    }
    this.inTransaction = true;
    this.db.prepare("BEGIN").run();
    try {
      const result = await fn();
      this.db.prepare("COMMIT").run();
      return result;
    } catch (error) {
      try {
        this.db.prepare("ROLLBACK").run();
      } catch {
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }
  async close() {
    this.db.close();
  }
  // ----------------------------------------------------------
  //  SQLite-specific features
  // ----------------------------------------------------------
  /**
   * Enables WAL (Write-Ahead Logging) mode for better performance.
   * Recommended for most applications.
   */
  enableWAL() {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
  }
  /**
   * Sets the busy timeout for locked database files.
   * Prevents "database is locked" errors in multi-process scenarios.
   *
   * @param ms - Timeout in milliseconds (default: 5000ms)
   */
  setBusyTimeout(ms = 5e3) {
    this.db.pragma(`busy_timeout = ${ms}`);
  }
  /**
   * Enables foreign key enforcement (disabled by default in SQLite!).
   * Always call this when using foreign key constraints.
   */
  enableForeignKeys() {
    this.db.pragma("foreign_keys = ON");
  }
  /**
   * Returns the SQLite version string.
   */
  async getVersion() {
    const rows = await this.query(
      "SELECT sqlite_version()"
    );
    return rows[0]?.["sqlite_version()"] ?? "unknown";
  }
  /**
   * Returns the list of tables in the database.
   */
  async listTables() {
    const rows = await this.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    return rows.map((r) => r.name);
  }
  /**
   * Returns the PRAGMA integrity_check result.
   * Use for database health checks.
   */
  async integrityCheck() {
    const rows = await this.query(
      "PRAGMA integrity_check"
    );
    return rows[0]?.integrity_check === "ok";
  }
  /**
   * Returns the raw better-sqlite3 Database instance.
   * Use for operations not covered by the standard interface.
   */
  getRaw() {
    return this.db;
  }
};
async function createSQLiteAdapter(filename, options) {
  let Database;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch {
    throw new Error(
      '[db-migrate-ts] SQLite adapter requires the "better-sqlite3" package.\nInstall it with: npm install better-sqlite3 @types/better-sqlite3'
    );
  }
  const db = new Database(filename);
  const adapter = new SQLiteAdapter(db);
  if (options?.wal) adapter.enableWAL();
  if (options?.foreignKeys !== false) adapter.enableForeignKeys();
  if (options?.busyTimeout) adapter.setBusyTimeout(options.busyTimeout);
  return adapter;
}

// src/schema/schema-registry.ts
var SchemaRegistry = class {
  schema;
  tableNames;
  constructor(schema) {
    this.schema = schema;
    this.tableNames = new Set(Object.keys(schema));
  }
  // ----------------------------------------------------------
  //  Table Access
  // ----------------------------------------------------------
  /**
   * Returns all table names defined in the schema.
   */
  getTableNames() {
    return Object.keys(this.schema);
  }
  /**
   * Returns the column schema for a specific table.
   *
   * @throws SchemaValidationError if the table doesn't exist
   */
  getTable(tableName) {
    const table = this.schema[tableName];
    if (!table) {
      throw new SchemaValidationError([
        `Table "${String(tableName)}" is not defined in the schema registry. Available tables: ${this.getTableNames().join(", ")}`
      ]);
    }
    return table;
  }
  /**
   * Checks whether a table exists in the schema.
   */
  hasTable(tableName) {
    return this.tableNames.has(tableName);
  }
  // ----------------------------------------------------------
  //  Column Access
  // ----------------------------------------------------------
  /**
   * Returns the column names for a specific table.
   */
  getColumnNames(tableName) {
    const table = this.getTable(tableName);
    return Object.keys(table);
  }
  /**
   * Returns the definition of a specific column.
   *
   * @throws SchemaValidationError if the column doesn't exist
   */
  getColumn(tableName, columnName) {
    const table = this.getTable(tableName);
    const column = table[columnName];
    if (!column) {
      const available = this.getColumnNames(tableName).join(", ");
      throw new SchemaValidationError([
        `Column "${String(columnName)}" doesn't exist in table "${String(tableName)}". Available columns: ${available}`
      ]);
    }
    return column;
  }
  /**
   * Checks whether a column exists in a table.
   */
  hasColumn(tableName, columnName) {
    if (!this.hasTable(tableName)) return false;
    const table = this.schema[tableName];
    return columnName in table;
  }
  // ----------------------------------------------------------
  //  Schema Introspection
  // ----------------------------------------------------------
  /**
   * Returns the primary key column(s) for a table.
   */
  getPrimaryKeys(tableName) {
    const table = this.getTable(tableName);
    return Object.entries(table).filter(([, def]) => def.primaryKey === true).map(([name]) => name);
  }
  /**
   * Returns all columns with UNIQUE constraints in a table.
   */
  getUniqueColumns(tableName) {
    const table = this.getTable(tableName);
    return Object.entries(table).filter(([, def]) => def.unique === true).map(([name]) => name);
  }
  /**
   * Returns all foreign key columns in a table.
   */
  getForeignKeys(tableName) {
    const table = this.getTable(tableName);
    return Object.entries(table).filter(([, def]) => def.references !== void 0).map(([columnName, def]) => ({
      columnName,
      references: def.references
    }));
  }
  /**
   * Returns all tables that reference a given table via foreign keys.
   */
  getDependentTables(targetTable) {
    const dependents = [];
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
  toJSON() {
    return this.schema;
  }
  /**
   * Returns a summary of the schema (table names + column counts).
   */
  getSummary() {
    return this.getTableNames().map((tableName) => ({
      table: String(tableName),
      columns: this.getColumnNames(tableName).length,
      hasPrimaryKey: this.getPrimaryKeys(tableName).length > 0
    }));
  }
};
function createRegistry(schema) {
  return new SchemaRegistry(schema);
}

// src/schema/schema-differ.ts
var SchemaDiffer = class {
  /**
   * Computes the diff between two schemas.
   *
   * @param oldSchema - The previous schema version
   * @param newSchema - The current (new) schema version
   * @returns A SchemaDiff describing all detected changes
   */
  diff(oldSchema, newSchema) {
    const changes = [];
    const oldTables = new Set(Object.keys(oldSchema));
    const newTables = new Set(Object.keys(newSchema));
    const addedTables = [];
    const removedTables = [];
    const modifiedTables = [];
    for (const tableName of newTables) {
      if (!oldTables.has(tableName)) {
        addedTables.push(tableName);
        changes.push({
          kind: "CREATE_TABLE",
          tableName,
          schema: newSchema[tableName]
        });
      }
    }
    for (const tableName of oldTables) {
      if (!newTables.has(tableName)) {
        removedTables.push(tableName);
        changes.push({ kind: "DROP_TABLE", tableName });
      }
    }
    for (const tableName of oldTables) {
      if (!newTables.has(tableName)) continue;
      const oldTable = oldSchema[tableName];
      const newTable = newSchema[tableName];
      const columnChanges = this.diffTableColumns(tableName, oldTable, newTable);
      if (columnChanges.length > 0) {
        modifiedTables.push(tableName);
        changes.push(...columnChanges);
      }
    }
    return {
      changes,
      addedTables,
      removedTables,
      modifiedTables,
      hasChanges: changes.length > 0
    };
  }
  // ----------------------------------------------------------
  //  Column-Level Diffing
  // ----------------------------------------------------------
  /**
   * Compares the columns of one table version against another.
   */
  diffTableColumns(tableName, oldTable, newTable) {
    const changes = [];
    const oldCols = new Set(Object.keys(oldTable));
    const newCols = new Set(Object.keys(newTable));
    for (const colName of newCols) {
      if (!oldCols.has(colName)) {
        changes.push({
          kind: "ADD_COLUMN",
          tableName,
          columnName: colName,
          definition: newTable[colName]
        });
      }
    }
    for (const colName of oldCols) {
      if (!newCols.has(colName)) {
        changes.push({
          kind: "DROP_COLUMN",
          tableName,
          columnName: colName
        });
      }
    }
    for (const colName of oldCols) {
      if (!newCols.has(colName)) continue;
      const oldDef = oldTable[colName];
      const newDef = newTable[colName];
      if (this.columnChanged(oldDef, newDef)) {
        changes.push({
          kind: "ALTER_COLUMN",
          tableName,
          columnName: colName,
          before: oldDef,
          after: newDef
        });
      }
    }
    return changes;
  }
  // ----------------------------------------------------------
  //  Column Change Detection
  // ----------------------------------------------------------
  /**
   * Determines whether two ColumnDefinitions are structurally different.
   *
   * Compares the serialized representation of both definitions.
   * Note: Function references (in Zod schemas) are compared by string representation.
   */
  columnChanged(oldDef, newDef) {
    return this.serializeColumn(oldDef) !== this.serializeColumn(newDef);
  }
  /**
   * Serializes a ColumnDefinition to a stable string for comparison.
   * Uses schema.toString() for Zod schemas (captures the definition structure).
   */
  serializeColumn(def) {
    return JSON.stringify({
      schema: def.schema.toString(),
      nullable: def.nullable,
      primaryKey: def.primaryKey,
      unique: def.unique,
      default: def.default,
      references: def.references ? {
        table: def.references.table,
        column: def.references.column,
        onDelete: def.references.onDelete,
        onUpdate: def.references.onUpdate
      } : void 0
    });
  }
};
function formatDiff(diff) {
  if (!diff.hasChanges) {
    return "\u2713 No schema changes detected.";
  }
  const lines = [
    `Found ${diff.changes.length} schema change(s):`,
    ""
  ];
  for (const change of diff.changes) {
    switch (change.kind) {
      case "CREATE_TABLE":
        lines.push(
          `  + CREATE TABLE "${change.tableName}" (${Object.keys(change.schema).length} columns)`
        );
        break;
      case "DROP_TABLE":
        lines.push(`  - DROP TABLE "${change.tableName}"`);
        break;
      case "RENAME_TABLE":
        lines.push(`  ~ RENAME TABLE "${change.from}" \u2192 "${change.to}"`);
        break;
      case "ADD_COLUMN":
        lines.push(`  + ADD COLUMN "${change.tableName}"."${change.columnName}"`);
        break;
      case "DROP_COLUMN":
        lines.push(`  - DROP COLUMN "${change.tableName}"."${change.columnName}"`);
        break;
      case "RENAME_COLUMN":
        lines.push(
          `  ~ RENAME COLUMN "${change.tableName}"."${change.from}" \u2192 "${change.to}"`
        );
        break;
      case "ALTER_COLUMN":
        lines.push(`  ~ ALTER COLUMN "${change.tableName}"."${change.columnName}"`);
        break;
      case "ADD_INDEX":
        lines.push(
          `  + ADD INDEX "${change.index.name}" ON "${change.tableName}" (${change.index.columns.join(", ")})`
        );
        break;
      case "DROP_INDEX":
        lines.push(`  - DROP INDEX "${change.indexName}"`);
        break;
    }
  }
  return lines.join("\n");
}

// src/sql/sql-formatter.ts
function formatSQL(sql) {
  const trimmed = sql.trim();
  if (trimmed.includes("\n")) {
    return trimmed;
  }
  const createTableMatch = /^(CREATE TABLE\s+\S+\s*)\((.+)\)$/i.exec(trimmed);
  if (createTableMatch) {
    const [, header, body] = createTableMatch;
    const columns = splitTopLevel(body, ",");
    return `${header.trim()} (
${columns.map((c) => `  ${c.trim()}`).join(",\n")}
)`;
  }
  return trimmed;
}
function formatSQLFile(statements, header) {
  const lines = [];
  if (header) {
    lines.push(header, "");
  }
  for (const stmt of statements) {
    const formatted = formatSQL(stmt);
    lines.push(formatted + ";", "");
  }
  return lines.join("\n");
}
function highlightSQL(sql) {
  const KEYWORDS = [
    "CREATE",
    "TABLE",
    "IF",
    "NOT",
    "EXISTS",
    "DROP",
    "ALTER",
    "ADD",
    "COLUMN",
    "RENAME",
    "TO",
    "MODIFY",
    "SET",
    "DEFAULT",
    "NULL",
    "PRIMARY",
    "KEY",
    "UNIQUE",
    "FOREIGN",
    "REFERENCES",
    "ON",
    "DELETE",
    "UPDATE",
    "CASCADE",
    "RESTRICT",
    "INDEX",
    "CONSTRAINT",
    "CHECK",
    "TRUNCATE",
    "INSERT",
    "SELECT",
    "FROM",
    "WHERE",
    "AND",
    "OR",
    "IN",
    "IS",
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "TRANSACTION",
    "BIGINT",
    "INTEGER",
    "INT",
    "TEXT",
    "VARCHAR",
    "BOOLEAN",
    "TIMESTAMP",
    "DATE",
    "JSON",
    "JSONB",
    "UUID",
    "SERIAL"
  ];
  return sql.replace(
    new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "gi"),
    (match) => `\x1B[36;1m${match.toUpperCase()}\x1B[0m`
  );
}
function splitTopLevel(str, separator) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of str) {
    if (char === "(") {
      depth++;
      current += char;
    } else if (char === ")") {
      depth--;
      current += char;
    } else if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

// src/sql/sql-sanitizer.ts
function validateIdentifier(identifier, context = "identifier") {
  if (!identifier || typeof identifier !== "string") {
    throw new Error(
      `[db-migrate-ts] Invalid ${context}: expected a non-empty string, got ${typeof identifier}`
    );
  }
  if (identifier.length > 128) {
    throw new Error(
      `[db-migrate-ts] ${context} "${identifier}" is too long. Maximum length is 128 characters.`
    );
  }
  const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
  if (!SAFE_IDENTIFIER.test(identifier)) {
    throw new Error(
      `[db-migrate-ts] Unsafe ${context}: "${identifier}". Use only letters, numbers, underscores, and dollar signs. Must start with a letter or underscore.`
    );
  }
}
function sanitizeLike(value) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
function escapeString(value) {
  return value.replace(/'/g, "''");
}
function validateIdentifiers(identifiers, context = "identifier") {
  for (const id of identifiers) {
    validateIdentifier(id, context);
  }
}
function detectSQLInjection(input) {
  const INJECTION_PATTERNS = [
    /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE)\s/i,
    /--\s/,
    /\/\*[\s\S]*?\*\//,
    /\bUNION\s+(?:ALL\s+)?SELECT\b/i,
    /\bOR\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i,
    /\bAND\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i,
    /\bXP_CMDSHELL\b/i,
    /\bEXEC\s*\(/i
  ];
  return INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}
function validateMigrationName(name) {
  const VALID_MIGRATION_NAME = /^\d{14}_[a-z][a-z0-9_]*$/;
  if (!VALID_MIGRATION_NAME.test(name)) {
    throw new Error(
      `[db-migrate-ts] Invalid migration name: "${name}". Expected format: {14-digit timestamp}_{snake_case_description} (e.g., "20241215120000_create_users_table")`
    );
  }
}
var MIGRATION_FILE_PATTERN = /^(\d{14})_([a-z][a-z0-9_]*)\.(?:ts|js|mjs|cjs)$/;
var MIGRATION_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"];
async function discoverMigrationFiles(migrationsDir) {
  const absoluteDir = resolve(migrationsDir);
  try {
    const stats = await stat(absoluteDir);
    if (!stats.isDirectory()) {
      throw new Error(
        `[db-migrate-ts] Migrations path is not a directory: ${absoluteDir}`
      );
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        `[db-migrate-ts] Migrations directory not found: ${absoluteDir}
Run "db-migrate-ts generate <name>" to create your first migration.`
      );
    }
    throw err;
  }
  const entries = await readdir(absoluteDir);
  const migrationFiles = [];
  for (const filename of entries) {
    const ext = extname(filename);
    if (!MIGRATION_EXTENSIONS.includes(ext)) {
      continue;
    }
    if (filename === "meta") continue;
    if (filename.endsWith(".snapshot.sql")) continue;
    const match = MIGRATION_FILE_PATTERN.exec(filename);
    if (!match) {
      continue;
    }
    const [, timestampStr, description] = match;
    const timestamp = parseInt(timestampStr, 10);
    const name = `${timestampStr}_${description}`;
    migrationFiles.push({
      path: join(absoluteDir, filename),
      filename,
      timestamp,
      description,
      name
    });
  }
  return migrationFiles.sort((a, b) => a.timestamp - b.timestamp);
}
async function loadMigrationFile(filePath) {
  let module;
  try {
    module = await import(
      /* @vite-ignore */
      filePath
    );
  } catch (err) {
    throw new Error(
      `[db-migrate-ts] Failed to import migration file: ${filePath}
Cause: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const migration = module.default ?? module.migration ?? module;
  validateMigrationShape(migration, filePath);
  return migration;
}
async function loadAllMigrations(migrationsDir) {
  const files = await discoverMigrationFiles(migrationsDir);
  const migrations = [];
  for (const fileInfo of files) {
    const migration = await loadMigrationFile(fileInfo.path);
    if (!migration.name) {
      migration.name = fileInfo.name;
    }
    if (!migration.timestamp) {
      migration.timestamp = fileInfo.timestamp;
    }
    migrations.push(migration);
  }
  return migrations;
}
function validateMigrationShape(migration, filePath) {
  const filename = basename(filePath);
  if (!migration || typeof migration !== "object") {
    throw new Error(
      `[db-migrate-ts] Invalid migration export in "${filename}": Expected an object, got ${typeof migration}. Make sure to export a Migration object (default export or named "migration" export).`
    );
  }
  const m = migration;
  if (typeof m["up"] !== "function") {
    throw new Error(
      `[db-migrate-ts] Invalid migration "${filename}": Missing or invalid "up" function. Expected a function, got ${typeof m["up"]}.`
    );
  }
  if (typeof m["down"] !== "function") {
    throw new Error(
      `[db-migrate-ts] Invalid migration "${filename}": Missing or invalid "down" function. Expected a function, got ${typeof m["down"]}.`
    );
  }
}
function generateTimestamp() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}
function sanitizeMigrationName(name) {
  return name.toLowerCase().trim().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/^_+|_+$/g, "").replace(/_+/g, "_");
}

// src/index.ts
var VERSION = "1.0.0";

export { BaseDialectAdapter, ChecksumMismatchError, DEFAULT_MIGRATIONS_TABLE, DIALECT_FEATURES, DatabaseConnectionError, EmptyTableSchemaError, InvalidRenameError, Logger, MIGRATION_FILE_PATTERN, MigrationBuilderImpl, MigrationError, MigrationExecutionError, MigrationLoadError, MigrationRunner, MigrationTracker, MigrationsDirNotFoundError, MySQLAdapter, PostgresAdapter, RollbackManager, SQLiteAdapter, SchemaDiffer, SchemaRegistry, SchemaValidationError, SchemaValidator, SqlBuilder, UnsupportedDialectOperationError, VERSION, ZodToSQLConverter, createLogger, createMySQLAdapter, createPostgresAdapter, createRegistry, createSQLiteAdapter, defaultLogger, defineConfig, detectSQLInjection, discoverMigrationFiles, escapeString, formatDiff, formatSQL, formatSQLFile, generateTimestamp, highlightSQL, loadAllMigrations, loadMigrationFile, sanitizeLike, sanitizeMigrationName, validateIdentifier, validateIdentifiers, validateMigrationName, validateSchema, validateSchemaOrThrow };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map