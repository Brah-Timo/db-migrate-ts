/**
 * @file errors.ts
 * @description Custom error classes for db-migrate-ts.
 *
 * Using typed error classes makes it easy for consumers to handle specific
 * failure cases differently (e.g. catch migration failures vs validation errors).
 */

/**
 * Base error class for all db-migrate-ts errors.
 * Adds context fields and a structured toString() for debugging.
 */
export class MigrationError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    this.context = context;

    // Maintains proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, new.target.prototype);
  }

  override toString(): string {
    const contextStr = Object.keys(this.context).length
      ? "\nContext: " + JSON.stringify(this.context, null, 2)
      : "";
    return `[${this.name}] ${this.code}: ${this.message}${contextStr}`;
  }
}

/** Thrown when a migration file is malformed or can't be loaded */
export class MigrationLoadError extends MigrationError {
  constructor(migrationName: string, cause: string) {
    super(
      `Failed to load migration "${migrationName}": ${cause}`,
      "MIGRATION_LOAD_ERROR",
      { migrationName, cause }
    );
    this.name = "MigrationLoadError";
  }
}

/** Thrown when a migration's checksum has changed after execution */
export class ChecksumMismatchError extends MigrationError {
  constructor(migrationName: string, expected: string, actual: string) {
    super(
      `Checksum mismatch for migration "${migrationName}". ` +
        `This migration was already executed but its content has changed. ` +
        `Expected: ${expected}, Got: ${actual}. ` +
        `Never edit a migration after it has been executed on any environment.`,
      "CHECKSUM_MISMATCH",
      { migrationName, expected, actual }
    );
    this.name = "ChecksumMismatchError";
  }
}

/** Thrown when a migration's up() or down() function fails */
export class MigrationExecutionError extends MigrationError {
  constructor(migrationName: string, direction: "up" | "down", cause: Error) {
    super(
      `Migration "${migrationName}" (${direction}) failed: ${cause.message}`,
      "MIGRATION_EXECUTION_ERROR",
      { migrationName, direction, originalError: cause.message }
    );
    this.name = "MigrationExecutionError";
    this.cause = cause;
  }
}

/** Thrown when the migrations directory doesn't exist */
export class MigrationsDirNotFoundError extends MigrationError {
  constructor(dir: string) {
    super(
      `Migrations directory not found: "${dir}". ` +
        `Create it manually or run "db-migrate-ts generate <name>" to create your first migration.`,
      "MIGRATIONS_DIR_NOT_FOUND",
      { dir }
    );
    this.name = "MigrationsDirNotFoundError";
  }
}

/** Thrown when a database connection fails */
export class DatabaseConnectionError extends MigrationError {
  constructor(dialect: string, cause: string) {
    super(
      `Failed to connect to ${dialect} database: ${cause}`,
      "DATABASE_CONNECTION_ERROR",
      { dialect, cause }
    );
    this.name = "DatabaseConnectionError";
  }
}

/** Thrown when a schema validation fails */
export class SchemaValidationError extends MigrationError {
  readonly violations: string[];

  constructor(violations: string[]) {
    super(
      `Schema validation failed with ${violations.length} violation(s):\n` +
        violations.map((v, i) => `  ${i + 1}. ${v}`).join("\n"),
      "SCHEMA_VALIDATION_ERROR",
      { violations }
    );
    this.name = "SchemaValidationError";
    this.violations = violations;
  }
}

/** Thrown when a migration is run in an unsupported dialect */
export class UnsupportedDialectOperationError extends MigrationError {
  constructor(operation: string, dialect: string, reason?: string) {
    super(
      `Operation "${operation}" is not supported in ${dialect} dialect. ` +
        (reason ? reason : ""),
      "UNSUPPORTED_DIALECT_OPERATION",
      { operation, dialect }
    );
    this.name = "UnsupportedDialectOperationError";
  }
}

/** Thrown when createTable is called with an empty schema */
export class EmptyTableSchemaError extends MigrationError {
  constructor(tableName: string) {
    super(
      `Cannot create table "${tableName}" with an empty schema. ` +
        `Define at least one column.`,
      "EMPTY_TABLE_SCHEMA",
      { tableName }
    );
    this.name = "EmptyTableSchemaError";
  }
}

/** Thrown when renameTable from === to */
export class InvalidRenameError extends MigrationError {
  constructor(kind: "table" | "column", from: string, to: string) {
    super(
      `Cannot rename ${kind}: "from" and "to" are the same ("${from}"). ` +
        `Provide different names.`,
      "INVALID_RENAME",
      { kind, from, to }
    );
    this.name = "InvalidRenameError";
  }
}
