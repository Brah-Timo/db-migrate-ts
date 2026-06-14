# CLI Reference

The `db-migrate-ts` CLI provides all common migration operations.

---

## Installation

```bash
# Use via npx (no install)
npx db-migrate-ts <command>

# Or install globally
npm install -g @db-migrate-ts/cli
db-migrate-ts <command>

# Or as a project dev dependency
pnpm add -D @db-migrate-ts/cli
npx db-migrate-ts <command>
```

---

## Global Options

| Flag | Description |
|------|-------------|
| `-c, --config <path>` | Path to config file (default: `./db-migrate.config.ts`) |
| `-v, --version` | Print the current version |
| `--help` | Show help for any command |

---

## `up` — Run Pending Migrations

Run all pending migrations in chronological order (oldest first).

```bash
db-migrate-ts up
db-migrate-ts up --dry-run
db-migrate-ts up --limit 3
db-migrate-ts up --config ./custom.config.ts
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dry-run` | `boolean` | `false` | Preview SQL without executing anything |
| `-l, --limit <n>` | `number` | *(all)* | Run at most N pending migrations |
| `-c, --config <path>` | `string` | `./db-migrate.config.ts` | Config file path |

### Example Output

```
⚡ db-migrate-ts — running migrations

  → 20241215120000_create_users_table   ✓ (42ms)
  → 20241216090000_create_posts_table   ✓ (31ms)
  → 20241217143025_add_avatar_to_users  ✓ (18ms)

✅ 3 migrations applied successfully. (Total: 91ms)
```

### Dry-Run Output

```
⚡ db-migrate-ts — DRY RUN (no changes will be made)

  → 20241215120000_create_users_table

    CREATE TABLE "users" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "email" VARCHAR(254) UNIQUE NOT NULL,
      "name" VARCHAR(100)
    );

ℹ️  Dry run complete. 1 migration would be applied.
```

---

## `down` — Roll Back Migrations

Roll back executed migrations in reverse chronological order.

```bash
db-migrate-ts down                                       # Roll back last 1
db-migrate-ts down --steps 3                             # Roll back last 3
db-migrate-ts down --to 20241215120000_create_users      # Roll back to specific
db-migrate-ts down --all                                 # Roll back everything ⚠️
db-migrate-ts down --dry-run                             # Preview only
db-migrate-ts down --yes                                 # Skip confirmation
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-s, --steps <n>` | `number` | `1` | Number of migrations to roll back |
| `--to <name>` | `string` | *(none)* | Roll back to (but NOT including) this migration |
| `--all` | `boolean` | `false` | Roll back ALL migrations (full reset) ⚠️ |
| `-y, --yes` | `boolean` | `false` | Skip the confirmation prompt |
| `--dry-run` | `boolean` | `false` | Preview SQL without executing |
| `-c, --config <path>` | `string` | `./db-migrate.config.ts` | Config file path |

### Example Output

```
⚡ db-migrate-ts — rolling back

  ← 20241217143025_add_avatar_to_users  ✓ (12ms)

✅ 1 migration rolled back successfully.
```

### `--all` Confirmation Prompt

```
⚠️  This will roll back ALL 12 migrations.
   This operation is IRREVERSIBLE — all data changes will be lost.

? Are you sure you want to continue? (y/N)
```

---

## `status` — Show Migration Status

Display the current state of all migrations (pending vs executed).

```bash
db-migrate-ts status
db-migrate-ts status --json
db-migrate-ts status --config ./custom.config.ts
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | `boolean` | `false` | Output as JSON (CI/CD friendly) |
| `-c, --config <path>` | `string` | `./db-migrate.config.ts` | Config file path |

### Table Output

```
┌──────────────────────────────────────────┬─────────────┬────────────────────────┬──────────┐
│ Migration                                │ Status      │ Executed At            │ Duration │
├──────────────────────────────────────────┼─────────────┼────────────────────────┼──────────┤
│ 20241215120000_create_users_table        │ ✅ executed │ 2024-12-15 14:31:02    │ 42ms     │
│ 20241216090000_create_posts_table        │ ✅ executed │ 2024-12-16 09:15:44    │ 31ms     │
│ 20241217143025_add_avatar_to_users       │ ✅ executed │ 2024-12-17 14:32:11    │ 18ms     │
│ 20241218080000_drop_legacy_sessions      │ ⏳ pending  │ —                      │ —        │
└──────────────────────────────────────────┴─────────────┴────────────────────────┴──────────┘

Summary: 3 executed, 1 pending
```

### JSON Output

```bash
db-migrate-ts status --json
```

```json
[
  {
    "name": "20241215120000_create_users_table",
    "timestamp": 20241215120000,
    "status": "executed",
    "executedAt": "2024-12-15T14:31:02.000Z",
    "durationMs": 42,
    "checksumValid": true
  },
  {
    "name": "20241218080000_drop_legacy_sessions",
    "timestamp": 20241218080000,
    "status": "pending",
    "executedAt": null,
    "durationMs": null,
    "checksumValid": null
  }
]
```

**CI/CD Usage:**

```bash
# Check if any migrations are pending
db-migrate-ts status --json | jq 'any(.[]; .status == "pending")'

# Get count of pending migrations
db-migrate-ts status --json | jq '[.[] | select(.status == "pending")] | length'
```

---

## `generate` — Create a New Migration File

Generate a new migration file with the correct timestamp prefix.

```bash
db-migrate-ts generate create_users_table
db-migrate-ts generate add_email_to_users  --template column
db-migrate-ts generate create_products     --template table
db-migrate-ts generate my_migration        --dir ./db/migrations
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-d, --dir <path>` | `string` | `config.migrationsDir` | Target directory |
| `--template <type>` | `"blank" \| "table" \| "column"` | `"blank"` | Starter template |
| `-c, --config <path>` | `string` | `./db-migrate.config.ts` | Config file path |

### Templates

| Template | Use For |
|----------|---------|
| `blank` | Any custom migration |
| `table` | Creating a new table with columns |
| `column` | Adding/modifying a column on an existing table |

### Output

```
✅ Migration created: migrations/20241215143025_create_users_table.ts
```

---

## `validate` — Validate Migration Files

Validates all migration files without executing them. Checks:

1. All files load without syntax errors
2. No duplicate timestamps
3. No duplicate migration names  
4. Schema definition is valid (if configured)
5. SQL generation succeeds for `up()` and `down()`
6. Warnings for empty `down()` functions

```bash
db-migrate-ts validate
db-migrate-ts validate --sql
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--sql` | `boolean` | `false` | Print the generated SQL for each migration |
| `-c, --config <path>` | `string` | `./db-migrate.config.ts` | Config file path |

### Output

```
⚡ db-migrate-ts — validating migrations

  ✓ 20241215120000_create_users_table
  ✓ 20241216090000_create_posts_table
  ⚠ 20241217143025_add_avatar_to_users  — empty down() function

✅ 3 migrations validated. 0 errors, 1 warning.
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (migration failed, validation failed, config error, etc.) |

Useful for CI/CD scripts:

```bash
npx db-migrate-ts up || exit 1
```

---

## Using with npm scripts

```json
{
  "scripts": {
    "migrate":          "db-migrate-ts up",
    "migrate:rollback": "db-migrate-ts down",
    "migrate:status":   "db-migrate-ts status",
    "migrate:generate": "db-migrate-ts generate",
    "migrate:validate": "db-migrate-ts validate",
    "migrate:dry-run":  "db-migrate-ts up --dry-run"
  }
}
```
