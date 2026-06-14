# Database Adapters

`db-migrate-ts` supports three databases through dedicated adapter classes.
Each adapter handles connection management, SQL dialect differences, and
transaction wrapping.

---

## PostgreSQL Adapter

### Install

```bash
npm install pg
npm install -D @types/pg
```

### Factory Function

```typescript
import { createPostgresAdapter } from "db-migrate-ts";

// Connection string
const adapter = await createPostgresAdapter("postgresql://user:pass@localhost:5432/mydb");

// Environment variable
const adapter = await createPostgresAdapter(process.env.DATABASE_URL!);

// With SSL (production)
const adapter = await createPostgresAdapter(process.env.DATABASE_URL!, {
  ssl: { rejectUnauthorized: true },
});
```

### Manual Construction (raw Pool)

```typescript
import { PostgresAdapter } from "db-migrate-ts";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

const adapter = new PostgresAdapter(pool);
```

### Config Shape

```typescript
interface PostgresConfig {
  connectionString?: string;   // Full DSN
  host?:             string;   // default: "localhost"
  port?:             number;   // default: 5432
  database?:         string;
  user?:             string;
  password?:         string;
  ssl?:              boolean | object;
  max?:              number;   // Pool size, default: 10
}
```

### PostgreSQL-Specific Features

- `UUID` primary keys via `gen_random_uuid()` or `uuid_generate_v4()`
- `JSONB` for objects/arrays
- `TIMESTAMPTZ` for dates
- `BOOLEAN` type
- Partial indexes (`WHERE` clause on `createIndex`)
- Concurrent indexes (`concurrently: true` option)
- `GIN`, `GIST`, `BRIN`, `SPGIST` index types

---

## MySQL Adapter

### Install

```bash
npm install mysql2
```

### Factory Function

```typescript
import { createMySQLAdapter } from "db-migrate-ts";

// Connection string
const adapter = await createMySQLAdapter("mysql://user:pass@localhost:3306/mydb");

// Environment variable
const adapter = await createMySQLAdapter(process.env.DATABASE_URL!);
```

### Manual Construction

```typescript
import { MySQLAdapter } from "db-migrate-ts";
import mysql from "mysql2/promise";

const pool = mysql.createPool({
  host:     "localhost",
  port:     3306,
  user:     "root",
  password: "secret",
  database: "myapp",
  waitForConnections: true,
  connectionLimit:    10,
});

const adapter = new MySQLAdapter(pool);
```

### Config Shape

```typescript
interface MySQLConfig {
  connectionString?: string;    // Full DSN (mysql://...)
  host?:             string;    // default: "localhost"
  port?:             number;    // default: 3306
  database?:         string;
  user?:             string;
  password?:         string;
  connectionLimit?:  number;    // Pool size, default: 10
  charset?:          string;    // default: "utf8mb4"
}
```

### MySQL-Specific Features

- `TINYINT(1)` for booleans
- `DATETIME` for dates (no timezone)
- `JSON` for objects/arrays (MySQL 5.7.8+)
- `VARCHAR(36)` for UUIDs
- `AUTO_INCREMENT` primary keys
- `DOUBLE` for floating-point numbers

---

## SQLite Adapter

### Install

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

### Factory Function

```typescript
import { createSQLiteAdapter } from "db-migrate-ts";

// File-based database
const adapter = await createSQLiteAdapter("./app.db");

// With WAL mode (recommended for concurrent access)
const adapter = await createSQLiteAdapter("./app.db", { wal: true });

// In-memory (useful for tests — destroyed when process exits)
const adapter = await createSQLiteAdapter(":memory:");
```

### Manual Construction

```typescript
import { SQLiteAdapter } from "db-migrate-ts";
import Database from "better-sqlite3";

const db = new Database("./app.db", { verbose: console.log });
db.pragma("journal_mode = WAL");

const adapter = new SQLiteAdapter(db);
```

### Config Shape

```typescript
interface SQLiteConfig {
  filename:  string;       // Path to .db file, or ":memory:"
  wal?:      boolean;      // Enable WAL mode (default: false)
  readonly?: boolean;      // Open in read-only mode
  timeout?:  number;       // Busy timeout in ms (default: 5000)
}
```

### SQLite-Specific Behaviour

- **No `ALTER COLUMN`:** SQLite doesn't support it natively — the library
  transparently recreates the table using a copy-rename strategy.
- **No partial indexes:** `WHERE` clause on `createIndex` is ignored.
- **`INTEGER` for booleans:** stored as `0`/`1`.
- **`TEXT` for dates:** stored as ISO 8601 strings.
- **`TEXT` for JSON:** no native JSON type.
- **`VARCHAR(36)` for UUIDs.**

---

## Closing Connections

Always close the adapter when done:

```typescript
import { createPostgresAdapter } from "db-migrate-ts";

const adapter = await createPostgresAdapter(process.env.DATABASE_URL!);

try {
  // ... run migrations ...
} finally {
  await adapter.close();
}
```

---

## Adapter Interface

All adapters implement the same `DatabaseAdapter` interface:

```typescript
interface DatabaseAdapter {
  /** Execute a SQL string with optional parameterized bindings */
  execute(sql: string, bindings?: unknown[]): Promise<void>;

  /** Execute a query and return rows */
  query<T = unknown>(sql: string, bindings?: unknown[]): Promise<T[]>;

  /** Wrap operations in a transaction */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /** Get the dialect name */
  readonly dialect: Dialect;

  /** Close the underlying connection/pool */
  close(): Promise<void>;
}
```

---

## Using Multiple Databases

If your app connects to multiple databases, create separate adapters per database:

```typescript
import { defineConfig, createPostgresAdapter, createSQLiteAdapter } from "db-migrate-ts";
import { MigrationRunner } from "db-migrate-ts";

// Primary database
const primary = await createPostgresAdapter(process.env.PRIMARY_DATABASE_URL!);

// Analytics database
const analytics = await createPostgresAdapter(process.env.ANALYTICS_DATABASE_URL!);

// Run migrations on each separately
const runner1 = new MigrationRunner(primary, { dialect: "postgres" });
const runner2 = new MigrationRunner(analytics, { dialect: "postgres" });
```

---

## Testing with SQLite

Use in-memory SQLite as a fast, zero-setup test database:

```typescript
// tests/setup.ts
import { createSQLiteAdapter, MigrationRunner, loadAllMigrations } from "db-migrate-ts";

export async function createTestDB() {
  const adapter = await createSQLiteAdapter(":memory:");
  const migrations = await loadAllMigrations("./migrations");
  const runner = new MigrationRunner(adapter, { dialect: "sqlite" });

  await runner.up(migrations);

  return { adapter, runner, migrations };
}
```

```typescript
// tests/user.test.ts
import { createTestDB } from "./setup.js";

test("creates user table", async () => {
  const { adapter } = await createTestDB();
  const rows = await adapter.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
  );
  expect(rows[0]?.name).toBe("users");
});
```
