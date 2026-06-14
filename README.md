# ⚡ `db-migrate-ts`

**Type-safe database migrations powered by Zod and TypeScript**

[![npm version](https://img.shields.io/npm/v/db-migrate-ts.svg)](https://www.npmjs.com/package/db-migrate-ts)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/db-migrate-ts)](https://bundlephobia.com/package/db-migrate-ts)

---

## The Problem

Every back-end developer knows this pain: you write a migration, deploy to production, and the app crashes because you wrote `user_name` instead of `username`, or `articls` instead of `articles`. This type of error doesn't show up at write-time — it shows up at the worst possible moment: **runtime, on the client's environment.**

Existing tools each solve part of the problem:
- **Prisma Migrate** — excellent type safety, but forces the entire Prisma ecosystem (ORM, schema format, `generate` step)
- **Knex.js** — lightweight and flexible, but no type safety on table/column names — you're working with plain strings
- **TypeORM** — Decorator-based approach that's confusing and adds overhead

**`db-migrate-ts` fills the gap:** as lightweight as Knex, as safe as Prisma, as simple as raw SQL — but with TypeScript in every corner.

---

## The Solution

```typescript
// ❌ BEFORE: Runtime crash on production
migrate.renameTable("poasts", "articles"); // Typo → runtime error

// ✅ AFTER: TypeScript error at write-time
migrate.renameTable("poasts", "articles");
//                  ^^^^^^^
// TypeScript Error: Argument of type '"poasts"' is not assignable to
// parameter of type '"users" | "posts" | "comments"'
```

---

## Features

| Feature | Description |
|---------|-------------|
| 🔒 **Type-safe table names** | Typos in table names → TypeScript compile errors |
| 🔒 **Type-safe column names** | Typos in column names → TypeScript compile errors |
| 🧩 **Zod integration** | Define columns using Zod schemas — type inference is automatic |
| 🗄️ **Multi-dialect** | PostgreSQL, MySQL, SQLite |
| ⚡ **Lightweight** | ~12KB gzipped, zero mandatory runtime dependencies |
| 🔄 **Rollback support** | Full `down()` migration support with step count or target name |
| ✅ **Checksum validation** | Detects tampered migrations after execution |
| 📸 **SQL snapshots** | Save generated SQL to files for review and auditing |
| 🖥️ **CLI** | Full-featured command-line tool |
| 🔍 **Dry-run mode** | Preview SQL without touching the database |
| 🏃 **Transaction-wrapped** | Each migration runs in a transaction (auto-rollback on failure) |

---

## Quick Start

### 1. Install

```bash
npm install db-migrate-ts zod
# With TypeScript (required)
npm install -D typescript

# Add your database driver:
npm install pg          # PostgreSQL
npm install mysql2      # MySQL
npm install better-sqlite3  # SQLite
```

### 2. Create config file

```typescript
// db-migrate.config.ts
import { defineConfig, createPostgresAdapter } from "db-migrate-ts";
import { z } from "zod";

export default defineConfig({
  adapter: "postgres",
  connection: await createPostgresAdapter(process.env.DATABASE_URL!),
  migrationsDir: "./migrations",

  // Define your schema for type-safe operations
  schema: {
    users: {
      id:    { schema: z.string().uuid(), primaryKey: true },
      email: { schema: z.string().email(), unique: true },
      name:  { schema: z.string().max(100) },
    },
    posts: {
      id:       { schema: z.number().int(), primaryKey: true },
      title:    { schema: z.string().max(255) },
      authorId: {
        schema: z.string().uuid(),
        references: { table: "users", column: "id", onDelete: "CASCADE" },
      },
    },
  },
});
```

### 3. Create your first migration

```bash
npx db-migrate-ts generate create_users_table --template table
```

This creates `migrations/20241215143025_create_users_table.ts`.

### 4. Edit the migration

```typescript
// migrations/20241215143025_create_users_table.ts
import type { Migration } from "db-migrate-ts";
import { z } from "zod";

export default {
  name: "20241215143025_create_users_table",
  timestamp: 20241215143025,

  up: async (migrate) => {
    migrate.createTable("users", {
      id: {
        schema: z.string().uuid(),
        primaryKey: true,
        default: "gen_random_uuid()",
      },
      email: {
        schema: z.string().email().max(254),
        unique: true,
      },
      name: {
        schema: z.string().max(100),
      },
      createdAt: {
        schema: z.date(),
        default: "NOW()",
      },
    });

    migrate.createIndex("users", ["email"], {
      name: "idx_users_email",
      unique: true,
    });
  },

  down: async (migrate) => {
    migrate.dropIndex("idx_users_email");
    migrate.dropTable("users");
  },
} satisfies Migration;
```

### 5. Run migrations

```bash
npx db-migrate-ts up
```

```
⚡ db-migrate-ts — running migrations

  → 20241215143025_create_users_table  ✓ (48ms)

✅ 1 migration applied successfully.
```

---

## CLI Commands

```bash
# Run all pending migrations
db-migrate-ts up

# Preview without executing
db-migrate-ts up --dry-run

# Roll back last migration
db-migrate-ts down

# Roll back last 3 migrations
db-migrate-ts down --steps 3

# Roll back to specific migration
db-migrate-ts down --to 20241215120000_create_users_table

# Show status table
db-migrate-ts status

# Show status as JSON (CI/CD friendly)
db-migrate-ts status --json

# Generate new migration file
db-migrate-ts generate add_age_to_users

# Generate with table template
db-migrate-ts generate create_products --template table

# Validate all migrations without running them
db-migrate-ts validate
```

---

## Type-Safe Migration API

All builder operations validate table and column names against your schema at **compile time**:

```typescript
// ✅ Valid — "users" and "email" exist in the schema
migrate.dropColumn("users", "email");

// ❌ TypeScript Error — "poasts" doesn't exist
migrate.renameTable("poasts", "articles");
// Error: Argument of type '"poasts"' is not assignable to
// parameter of type '"users" | "posts"'

// ❌ TypeScript Error — "usr_email" is not a column of "users"  
migrate.alterColumn("users", "usr_email", { schema: z.string() });
// Error: Argument of type '"usr_email"' is not assignable to
// parameter of type '"id" | "email" | "name" | "createdAt"'
```

### Full Builder API

```typescript
// Table operations
migrate.createTable(tableName, schema)
migrate.dropTable(tableName, { ifExists?, cascade? })
migrate.renameTable(from, to)
migrate.truncateTable(tableName)

// Column operations
migrate.addColumn(tableName, columnName, definition)
migrate.dropColumn(tableName, columnName)       // ← columnName is type-safe!
migrate.renameColumn(tableName, from, to)        // ← from is type-safe!
migrate.alterColumn(tableName, columnName, def)  // ← columnName is type-safe!
migrate.setNotNull(tableName, columnName)
migrate.dropNotNull(tableName, columnName)
migrate.setDefault(tableName, columnName, value)
migrate.dropDefault(tableName, columnName)

// Index operations
migrate.createIndex(tableName, columns, { unique?, where?, using?, name? })
migrate.dropIndex(indexName, { ifExists?, cascade? })

// Constraint operations
migrate.addForeignKey(tableName, columnName, references)
migrate.dropForeignKey(tableName, constraintName)
migrate.addCheck(tableName, constraintName, expression)
migrate.dropCheck(tableName, constraintName)

// Escape hatch for complex SQL
migrate.raw(sql, bindings?)
```

---

## Zod → SQL Type Mapping

| Zod Schema | PostgreSQL | MySQL | SQLite |
|------------|-----------|-------|--------|
| `z.string()` | `TEXT` | `TEXT` | `TEXT` |
| `z.string().max(100)` | `VARCHAR(100)` | `VARCHAR(100)` | `VARCHAR(100)` |
| `z.string().uuid()` | `UUID` | `VARCHAR(36)` | `VARCHAR(36)` |
| `z.string().email()` | `VARCHAR(254)` | `VARCHAR(254)` | `VARCHAR(254)` |
| `z.number().int()` | `INTEGER` | `INT` | `INTEGER` |
| `z.number()` | `DOUBLE PRECISION` | `DOUBLE` | `REAL` |
| `z.bigint()` | `BIGINT` | `BIGINT` | `BIGINT` |
| `z.boolean()` | `BOOLEAN` | `TINYINT(1)` | `INTEGER` |
| `z.date()` | `TIMESTAMPTZ` | `DATETIME` | `TEXT` |
| `z.object({...})` | `JSONB` | `JSON` | `TEXT` |
| `z.array(...)` | `JSONB` | `JSON` | `TEXT` |
| `z.enum([...])` | `TEXT` | `VARCHAR(100)` | `TEXT` |
| `z.string().optional()` | `TEXT` (nullable) | `TEXT` (nullable) | `TEXT` (nullable) |

---

## Database Adapters

```typescript
// PostgreSQL
import { createPostgresAdapter } from "db-migrate-ts";
const adapter = await createPostgresAdapter(process.env.DATABASE_URL);

// MySQL
import { createMySQLAdapter } from "db-migrate-ts";
const adapter = await createMySQLAdapter(process.env.DATABASE_URL);

// SQLite
import { createSQLiteAdapter } from "db-migrate-ts";
const adapter = await createSQLiteAdapter("./app.db", { wal: true });

// In-memory SQLite (testing)
const adapter = await createSQLiteAdapter(":memory:");
```

---

## Advanced Usage

### Programmatic API

```typescript
import { MigrationRunner, createPostgresAdapter, loadAllMigrations } from "db-migrate-ts";

const adapter = await createPostgresAdapter(process.env.DATABASE_URL!);
const migrations = await loadAllMigrations("./migrations");

const runner = new MigrationRunner(adapter, {
  dialect: "postgres",
  validateChecksums: true,
  saveSQLSnapshots: true,
  snapshotsDir: "./migrations/snapshots",
});

// Apply all pending
await runner.up(migrations);

// Roll back 2 steps
await runner.down(migrations, 2);

// Get status
const status = await runner.status(migrations);
console.table(status);

await adapter.close();
```

### Advanced Rollback

```typescript
import { RollbackManager } from "db-migrate-ts";

const manager = new RollbackManager(adapter, migrations, "postgres");

// Roll back everything after a specific migration
await manager.rollbackTo("20241215120000_create_users_table");

// Roll back all (full reset)
await manager.rollbackAll();

// Preview without executing
const plan = await manager.preview("20241215120000_create_users_table");
console.log("Would roll back:", plan.map(m => m.name));
```

### Schema Registry (Type Inference)

```typescript
import { createRegistry } from "db-migrate-ts";
import type { InferTableType } from "db-migrate-ts";

const registry = createRegistry(mySchema);

// Infer the TypeScript type of a table row
type UserRow = InferTableType<typeof mySchema.users>;
// → { id: string; email: string; name: string; createdAt: Date }

// Insert type (required fields only, optional fields... optional)
type InsertUser = InsertType<typeof mySchema.users>;

// Query type-safety
const users: UserRow[] = await db.query("SELECT * FROM users");
users[0].email; // ✅ TypeScript knows this is string
```

---

## Project Structure

```
your-project/
├── db-migrate.config.ts   ← Configuration
├── migrations/
│   ├── 20241215120000_create_users.ts
│   ├── 20241216090000_create_posts.ts
│   └── snapshots/          ← Generated SQL snapshots
└── package.json
```

---

## Architecture

```
db-migrate-ts/
├── packages/
│   ├── core/               ← Main library (MIT)
│   │   ├── src/types/      ← Type system (column, table, migration, dialect)
│   │   ├── src/schema/     ← Zod→SQL converter, registry, differ, validator
│   │   ├── src/migration/  ← Builder, runner, tracker, rollback manager
│   │   ├── src/sql/        ← SQL builder, formatter, sanitizer
│   │   └── src/dialects/   ← PostgreSQL, MySQL, SQLite adapters
│   ├── cli/                ← CLI tool (MIT)
│   └── gui/                ← Desktop GUI (Pro — $39 one-time)
└── examples/
    ├── with-postgres/
    ├── with-mysql/
    └── with-nextjs/
```

---

## Pro GUI ($39 — one-time license)

The Pro GUI is a desktop application (Electron + React) with:

- **Visual Schema Diff** — side-by-side comparison of old vs new schema
- **SQL Preview** — see the exact SQL before executing any migration
- **One-click Rollback** — roll back any migration with a single click
- **Migration Timeline** — visual history graph of all migrations
- **Live Connection** — connects to your database and shows live table state
- **Checksum Alerts** — instantly warns when a migration has been tampered with

---

## Comparison

| Feature | db-migrate-ts | Prisma Migrate | Knex.js | TypeORM |
|---------|:---:|:---:|:---:|:---:|
| Type-safe table names | ✅ | ✅ | ❌ | ⚠️ |
| Type-safe column names | ✅ | ✅ | ❌ | ⚠️ |
| Zod integration | ✅ | ❌ | ❌ | ❌ |
| ORM-free | ✅ | ❌ | ✅ | ❌ |
| Multi-dialect | ✅ | ✅ | ✅ | ✅ |
| Rollback | ✅ | ⚠️ | ✅ | ✅ |
| Bundle size | ~12KB | ~5MB | ~800KB | ~2MB |
| License | MIT | Apache-2 | MIT | MIT |

---

## License

**Core & CLI:** MIT — free forever.  
**GUI:** Commercial ($39 one-time license).

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

```bash
git clone https://github.com/Brah-Timo/db-migrate-ts
cd db-migrate-ts
pnpm install
pnpm build
pnpm test
```
