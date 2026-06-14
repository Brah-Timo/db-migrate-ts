# Programmatic API

In addition to the CLI, you can use `db-migrate-ts` directly in your Node.js code
for custom scripts, integration into deployment pipelines, or programmatic testing.

---

## `MigrationRunner`

The core class that manages running and rolling back migrations.

### Constructor

```typescript
import { MigrationRunner } from "db-migrate-ts";

const runner = new MigrationRunner(adapter, {
  dialect:           "postgres",
  migrationsTable:   "__db_migrations",  // default
  validateChecksums: true,               // default
  saveSQLSnapshots:  false,              // default
  snapshotsDir:      "./migrations/snapshots",
  dryRun:            false,
  logger:            (msg) => console.log(msg),
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dialect` | `"postgres" \| "mysql" \| "sqlite"` | *(required)* | Database dialect |
| `migrationsTable` | `string` | `"__db_migrations"` | Name of the tracking table |
| `validateChecksums` | `boolean` | `true` | Verify checksums of executed migrations |
| `saveSQLSnapshots` | `boolean` | `false` | Save SQL to `.sql` snapshot files |
| `snapshotsDir` | `string` | `"{migrationsDir}/snapshots"` | Directory for snapshots |
| `dryRun` | `boolean` | `false` | Compile SQL but don't execute |
| `logger` | `(msg: string) => void` | `console.log` | Custom log function |

### Methods

#### `up(migrations, limit?)`

Run all pending migrations, optionally limited to `limit` at most.

```typescript
const migrations = await loadAllMigrations("./migrations");
const result = await runner.up(migrations);

console.log(`Applied ${result.applied.length} migrations`);
console.log(`Skipped ${result.skipped.length} migrations`);

// result shape:
// {
//   applied: MigrationStatusEntry[],
//   skipped: MigrationStatusEntry[],
//   errors:  { migration: string; error: Error }[]
// }
```

```typescript
// Run at most 5 pending migrations
const result = await runner.up(migrations, 5);
```

#### `down(migrations, steps?)`

Roll back the last `steps` executed migrations (default: 1).

```typescript
// Roll back the last 1
await runner.down(migrations);

// Roll back the last 3
await runner.down(migrations, 3);
```

#### `status(migrations)`

Get the status of every migration.

```typescript
const statuses = await runner.status(migrations);
//    statuses: MigrationStatusEntry[]

for (const s of statuses) {
  console.log(`${s.name}: ${s.status} (${s.executedAt?.toISOString() ?? "not run"})`);
}
```

`MigrationStatusEntry`:

```typescript
interface MigrationStatusEntry {
  name:          string;
  timestamp:     number;
  status:        "pending" | "executed" | "failed" | "skipped";
  executedAt?:   Date;
  durationMs?:   number;
  checksumValid?: boolean;
}
```

---

## `RollbackManager`

More advanced rollback operations beyond simple step-based rollback.

```typescript
import { RollbackManager } from "db-migrate-ts";

const manager = new RollbackManager(adapter, migrations, "postgres");
```

### Methods

#### `rollbackTo(migrationName)`

Roll back all migrations **after** (and including) the named migration.

```typescript
// Rolls back everything after (and including) the named migration
await manager.rollbackTo("20241215120000_create_users_table");
```

#### `rollbackAll()`

Roll back every executed migration (complete database reset).

```typescript
await manager.rollbackAll();
```

#### `preview(targetName?)`

Preview which migrations would be rolled back without executing.

```typescript
const plan = await manager.preview("20241215120000_create_users_table");
console.log("Would roll back:", plan.map(m => m.name));
```

---

## `loadAllMigrations`

Discovers and loads all migration files from a directory.

```typescript
import { loadAllMigrations } from "db-migrate-ts";

const migrations = await loadAllMigrations("./migrations");
// Returns Migration[] sorted by timestamp (oldest first)
```

### `loadMigrationFile`

Load a single migration file:

```typescript
import { loadMigrationFile } from "db-migrate-ts";

const migration = await loadMigrationFile("./migrations/20241215120000_create_users.ts");
```

### `discoverMigrationFiles`

Get file paths only (without loading):

```typescript
import { discoverMigrationFiles } from "db-migrate-ts";

const files = await discoverMigrationFiles("./migrations");
// → ["./migrations/20241215120000_create_users.ts", ...]
```

---

## Complete Example: Deployment Script

```typescript
// scripts/migrate.ts
import { createPostgresAdapter, MigrationRunner, loadAllMigrations } from "db-migrate-ts";

async function runMigrations() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

  const adapter = await createPostgresAdapter(DATABASE_URL);
  const migrations = await loadAllMigrations("./migrations");

  const runner = new MigrationRunner(adapter, {
    dialect:           "postgres",
    validateChecksums: true,
    saveSQLSnapshots:  process.env.SAVE_SNAPSHOTS === "1",
    logger:            (msg) => process.stdout.write(msg + "\n"),
  });

  try {
    // Show current status before running
    const before = await runner.status(migrations);
    const pending = before.filter(s => s.status === "pending");

    if (pending.length === 0) {
      console.log("✅ No pending migrations.");
      return;
    }

    console.log(`\nRunning ${pending.length} pending migration(s)...\n`);
    const result = await runner.up(migrations);

    if (result.errors.length > 0) {
      console.error("\n❌ Migration failed:");
      for (const err of result.errors) {
        console.error(`  ${err.migration}: ${err.error.message}`);
      }
      process.exit(1);
    }

    console.log(`\n✅ ${result.applied.length} migration(s) applied successfully.`);
  } finally {
    await adapter.close();
  }
}

runMigrations().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

Run:

```bash
npx tsx scripts/migrate.ts
```

---

## Complete Example: Test Setup

```typescript
// tests/helpers/db.ts
import {
  createSQLiteAdapter,
  MigrationRunner,
  loadAllMigrations,
  type DatabaseAdapter,
} from "db-migrate-ts";

let adapter: DatabaseAdapter | null = null;

export async function setupTestDB(): Promise<DatabaseAdapter> {
  adapter = await createSQLiteAdapter(":memory:");
  const migrations = await loadAllMigrations("./migrations");

  const runner = new MigrationRunner(adapter, {
    dialect:           "sqlite",
    validateChecksums: false, // not needed in test env
    logger:            () => {}, // silence output
  });

  await runner.up(migrations);
  return adapter;
}

export async function teardownTestDB(): Promise<void> {
  await adapter?.close();
  adapter = null;
}
```

```typescript
// tests/users.test.ts
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { setupTestDB, teardownTestDB } from "./helpers/db.js";
import type { DatabaseAdapter } from "db-migrate-ts";

let db: DatabaseAdapter;

beforeAll(async () => { db = await setupTestDB(); });
afterAll(async () => { await teardownTestDB(); });

it("can insert and query users", async () => {
  await db.execute(
    "INSERT INTO users (id, email, name) VALUES (?, ?, ?)",
    ["user-1", "alice@example.com", "Alice"]
  );

  const rows = await db.query<{ id: string; email: string }>(
    "SELECT id, email FROM users WHERE id = ?",
    ["user-1"]
  );

  expect(rows[0]?.email).toBe("alice@example.com");
});
```

---

## `MigrationTracker`

Low-level access to the migrations history table:

```typescript
import { MigrationTracker, DEFAULT_MIGRATIONS_TABLE } from "db-migrate-ts";

const tracker = new MigrationTracker(adapter, DEFAULT_MIGRATIONS_TABLE);

// Check if a migration has been executed
const isExecuted = await tracker.isExecuted("20241215120000_create_users_table");

// Get all executed migration records
const records = await tracker.getAllExecuted();
// records: MigrationRecord[]

// Record a successful execution
await tracker.recordExecution({
  name:       "20241215120000_create_users_table",
  timestamp:  20241215120000,
  checksum:   "abc123...",
  durationMs: 42,
});
```
