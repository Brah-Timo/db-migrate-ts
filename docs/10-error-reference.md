# Error Reference

All errors thrown by `db-migrate-ts` extend the base `MigrationError` class,
making them easy to identify and handle separately from other runtime errors.

---

## Base Class: `MigrationError`

```typescript
import { MigrationError } from "db-migrate-ts";

try {
  await runner.up(migrations);
} catch (err) {
  if (err instanceof MigrationError) {
    console.error("Migration error:", err.code, err.message);
    console.error("Context:", err.context);
  } else {
    throw err; // re-throw unexpected errors
  }
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `message` | `string` | Human-readable error message |
| `code` | `string` | Machine-readable error code (see below) |
| `context` | `Record<string, unknown>` | Structured context data |
| `name` | `string` | Error class name |

### `toString()`

```typescript
err.toString();
// [MigrationError] CHECKSUM_MISMATCH: Checksum mismatch for migration "..."
// Context: {
//   "migrationName": "20241215120000_create_users_table",
//   "expected": "abc123...",
//   "actual":   "def456..."
// }
```

---

## Error Classes

### `MigrationLoadError`

**Code:** `MIGRATION_LOAD_ERROR`

Thrown when a migration file cannot be loaded or is structurally invalid.

**Causes:**
- Syntax error in the migration file
- Missing required `name`, `timestamp`, `up`, or `down` fields
- File not found at the expected path
- Module resolution error

```typescript
import { MigrationLoadError } from "db-migrate-ts";

catch (err) {
  if (err instanceof MigrationLoadError) {
    console.error(`Failed to load: ${err.context.migrationName}`);
    console.error(`Reason: ${err.context.cause}`);
  }
}
```

**Context:**
```typescript
{
  migrationName: string;  // e.g. "20241215120000_create_users_table"
  cause:         string;  // human-readable cause
}
```

---

### `ChecksumMismatchError`

**Code:** `CHECKSUM_MISMATCH`

Thrown when a previously-executed migration's SHA-256 checksum no longer matches
the file on disk. This means someone edited the migration after it ran.

> **Rule:** Never edit a migration file after it has executed on any environment.

```typescript
import { ChecksumMismatchError } from "db-migrate-ts";

catch (err) {
  if (err instanceof ChecksumMismatchError) {
    console.error(`Migration was edited: ${err.context.migrationName}`);
    console.error(`Expected checksum: ${err.context.expected}`);
    console.error(`Actual checksum:   ${err.context.actual}`);
  }
}
```

**Context:**
```typescript
{
  migrationName: string;  // Migration that was tampered
  expected:      string;  // Checksum stored in DB
  actual:        string;  // Checksum of current file
}
```

**Resolution:**
1. Don't edit executed migrations. Create a new migration instead.
2. If the edit was intentional (e.g. fixing a bug in dev), manually reset the
   checksum in the `__db_migrations` table or re-run `down + up`.

---

### `MigrationExecutionError`

**Code:** `MIGRATION_EXECUTION_ERROR`

Thrown when a migration's `up()` or `down()` function throws or the generated SQL fails.

```typescript
import { MigrationExecutionError } from "db-migrate-ts";

catch (err) {
  if (err instanceof MigrationExecutionError) {
    console.error(`Migration failed: ${err.context.migrationName}`);
    console.error(`Direction: ${err.context.direction}`); // "up" | "down"
    console.error(`SQL: ${err.context.sql}`);
    console.error(`Cause: ${err.context.cause}`);
  }
}
```

**Context:**
```typescript
{
  migrationName: string;           // Which migration failed
  direction:     "up" | "down";    // Which function failed
  sql?:          string;           // The SQL that caused the failure
  cause:         string;           // Original database error message
}
```

**Note:** Because migrations run inside a transaction, a failure in `up()` or `down()`
automatically rolls back all changes made in that migration.

---

### `MigrationsDirNotFoundError`

**Code:** `MIGRATIONS_DIR_NOT_FOUND`

Thrown when `migrationsDir` doesn't exist or can't be read.

```typescript
import { MigrationsDirNotFoundError } from "db-migrate-ts";

catch (err) {
  if (err instanceof MigrationsDirNotFoundError) {
    console.error(`Directory not found: ${err.context.path}`);
  }
}
```

**Context:**
```typescript
{
  path: string;  // The absolute path that was not found
}
```

---

### `DatabaseConnectionError`

**Code:** `DATABASE_CONNECTION_ERROR`

Thrown when the adapter cannot connect to the database.

```typescript
import { DatabaseConnectionError } from "db-migrate-ts";

catch (err) {
  if (err instanceof DatabaseConnectionError) {
    console.error(`Cannot connect: ${err.context.host}:${err.context.port}`);
    console.error(`Cause: ${err.context.cause}`);
  }
}
```

**Context:**
```typescript
{
  host?:  string;
  port?:  number;
  cause:  string;  // Database driver error message
}
```

---

### `SchemaValidationError`

**Code:** `SCHEMA_VALIDATION_ERROR`

Thrown by `defineConfig()` when the provided `schema` fails validation.

```typescript
import { SchemaValidationError } from "db-migrate-ts";

catch (err) {
  if (err instanceof SchemaValidationError) {
    console.error(`Schema invalid: ${err.context.errors}`);
  }
}
```

**Context:**
```typescript
{
  errors:   string[];  // List of validation error messages
  warnings: string[];  // Non-fatal warnings
}
```

---

### `UnsupportedDialectOperationError`

**Code:** `UNSUPPORTED_DIALECT_OPERATION`

Thrown when an operation is called that isn't supported by the current dialect.

Example: calling `createIndex` with `concurrently: true` on SQLite.

```typescript
import { UnsupportedDialectOperationError } from "db-migrate-ts";

catch (err) {
  if (err instanceof UnsupportedDialectOperationError) {
    console.error(`${err.context.operation} is not supported by ${err.context.dialect}`);
  }
}
```

**Context:**
```typescript
{
  operation: string;  // e.g. "createIndex with concurrently"
  dialect:   string;  // e.g. "sqlite"
}
```

---

### `EmptyTableSchemaError`

**Code:** `EMPTY_TABLE_SCHEMA`

Thrown when `createTable()` is called with an empty columns object.

```typescript
migrate.createTable("empty", {});
// → throws EmptyTableSchemaError
```

---

### `InvalidRenameError`

**Code:** `INVALID_RENAME`

Thrown when a rename operation specifies the same name for source and destination.

```typescript
migrate.renameTable("users", "users");
// → throws InvalidRenameError
```

---

## Error Handling Patterns

### Ignore Missing (for `down()` functions)

```typescript
import { MigrationExecutionError } from "db-migrate-ts";

// In down(), tables/columns may already be gone — use IF EXISTS
down: async (migrate) => {
  migrate.dropTable("users", { ifExists: true });     // ✅ safe
  migrate.dropIndex("idx_users_email", { ifExists: true }); // ✅ safe
},
```

### Catch and Continue

```typescript
for (const migration of migrations) {
  try {
    await runner.up([migration]);
  } catch (err) {
    if (err instanceof MigrationExecutionError) {
      console.error(`Skipping failed migration: ${migration.name}`);
      continue; // dangerous — only in dev/test environments!
    }
    throw err;
  }
}
```

### Structured Logging

```typescript
import { MigrationError } from "db-migrate-ts";

try {
  await runner.up(migrations);
} catch (err) {
  if (err instanceof MigrationError) {
    logger.error({
      event:   "migration_failed",
      code:    err.code,
      message: err.message,
      context: err.context,
    });
    process.exit(1);
  }
  throw err;
}
```
