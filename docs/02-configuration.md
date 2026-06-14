# Configuration

All configuration is done via `defineConfig()` in a `db-migrate.config.ts` file.

---

## `defineConfig(config)`

The main configuration factory. It provides:
- TypeScript type inference for your schema
- Runtime validation of all config fields
- Schema validation warnings at startup

```typescript
import { defineConfig, createPostgresAdapter } from "db-migrate-ts";
import { z } from "zod";

export default defineConfig({
  adapter:       "postgres",
  connection:    await createPostgresAdapter(process.env.DATABASE_URL!),
  migrationsDir: "./migrations",
  schema:        { /* your schema */ },
  options:       { /* runner options */ },
});
```

---

## Config Fields

### `adapter` *(required)*

The database dialect. Affects SQL generation style.

| Value | Database |
|-------|----------|
| `"postgres"` | PostgreSQL 12+ |
| `"mysql"` | MySQL 8+ / MariaDB 10.5+ |
| `"sqlite"` | SQLite 3+ (via better-sqlite3) |

```typescript
adapter: "postgres"
```

---

### `connection` *(required)*

A `DatabaseAdapter` instance. Use the factory functions:

```typescript
// PostgreSQL — accepts a connection string or Pool object
import { createPostgresAdapter } from "db-migrate-ts";
const connection = await createPostgresAdapter(process.env.DATABASE_URL!);

// MySQL — accepts a connection string or pool
import { createMySQLAdapter } from "db-migrate-ts";
const connection = await createMySQLAdapter(process.env.DATABASE_URL!);

// SQLite — accepts a file path or ":memory:"
import { createSQLiteAdapter } from "db-migrate-ts";
const connection = await createSQLiteAdapter("./app.db", { wal: true });
```

See the [Adapters guide](./06-adapters.md) for advanced options.

---

### `migrationsDir` *(required)*

Path to the directory containing your migration files.
Relative paths are resolved from `process.cwd()`.

```typescript
migrationsDir: "./migrations"
migrationsDir: "./db/migrations"
migrationsDir: "/absolute/path/migrations"
```

---

### `schema` *(optional)*

Your database schema definition using Zod types. When provided:
- `dropColumn()`, `renameColumn()`, `alterColumn()` validate names at **compile time**
- Schema is validated at startup and warnings are printed for issues

```typescript
schema: {
  users: {
    id: {
      schema:     z.string().uuid(),
      primaryKey: true,
      default:    "gen_random_uuid()",
    },
    email: {
      schema: z.string().email().max(254),
      unique: true,
    },
    name: {
      schema:   z.string().max(100),
      nullable: true,
    },
    createdAt: {
      schema:  z.date(),
      default: "NOW()",
    },
  },
  posts: {
    id: {
      schema:     z.number().int(),
      primaryKey: true,
    },
    title: {
      schema: z.string().max(255),
    },
    authorId: {
      schema:     z.string().uuid(),
      references: { table: "users", column: "id", onDelete: "CASCADE" },
    },
  },
}
```

---

### `options` *(optional)*

Advanced runner behaviour:

```typescript
options: {
  // Custom name for the migrations history table
  // Default: "__db_migrations"
  migrationsTable: "__db_migrations",

  // Whether to verify SHA-256 checksums of previously-executed migrations.
  // Detects if someone edited a migration after it ran.
  // Default: true
  validateChecksums: true,

  // Save generated SQL to .sql files for review and auditing.
  // Default: false
  saveSQLSnapshots: false,

  // Directory for SQL snapshot files (relative to cwd).
  // Default: "{migrationsDir}/snapshots"
  snapshotsDir: "./migrations/snapshots",
}
```

---

## Column Definition Fields

Each column in your schema accepts these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema` | `z.ZodTypeAny` | ✅ | Zod schema determining the SQL type |
| `primaryKey` | `boolean` | ❌ | Mark as PRIMARY KEY |
| `unique` | `boolean` | ❌ | Add UNIQUE constraint |
| `nullable` | `boolean` | ❌ | Allow NULL values (default: false if not optional Zod) |
| `default` | `string \| number \| boolean` | ❌ | DEFAULT value (string = SQL expression) |
| `references` | `ForeignKeyRef` | ❌ | Foreign key reference |
| `check` | `CheckConstraint` | ❌ | CHECK constraint expression |
| `generated` | `GenerationStrategy` | ❌ | `ALWAYS` or `BY DEFAULT` (PostgreSQL identity) |
| `comment` | `string` | ❌ | Column comment (PostgreSQL / MySQL) |

### Foreign Key Reference

```typescript
references: {
  table:    "users",      // Referenced table name
  column:   "id",         // Referenced column
  onDelete: "CASCADE",    // "CASCADE" | "SET NULL" | "RESTRICT" | "NO ACTION"
  onUpdate: "NO ACTION",
}
```

---

## Config File Location

The CLI searches for the config file in this order:

1. `--config <path>` flag
2. `./db-migrate.config.ts`
3. `./db-migrate.config.js`
4. `./db-migrate.config.mjs`

---

## Environment Variables Pattern

```typescript
// db-migrate.config.ts
import { defineConfig, createPostgresAdapter } from "db-migrate-ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

export default defineConfig({
  adapter: "postgres",
  connection: await createPostgresAdapter(DATABASE_URL),
  migrationsDir: "./migrations",
  options: {
    validateChecksums: process.env.NODE_ENV === "production",
    saveSQLSnapshots:  process.env.NODE_ENV === "production",
  },
});
```

---

## Using `.env` Files

`db-migrate-ts` does not load `.env` files automatically. Use `dotenv` before importing:

```typescript
// db-migrate.config.ts
import "dotenv/config";
import { defineConfig, createPostgresAdapter } from "db-migrate-ts";

export default defineConfig({
  adapter: "postgres",
  connection: await createPostgresAdapter(process.env.DATABASE_URL!),
  migrationsDir: "./migrations",
});
```

Or use the CLI with `dotenv-cli`:

```bash
npx dotenv-cli -- npx db-migrate-ts up
```
