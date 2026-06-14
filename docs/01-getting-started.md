# Getting Started

This guide walks you from zero to your first migration running against a real database.

---

## 1. Install

```bash
# Core library + Zod (required peer dependency)
npm install db-migrate-ts zod
# or
pnpm add db-migrate-ts zod
# or
yarn add db-migrate-ts zod
```

TypeScript is required:

```bash
npm install -D typescript
```

Add your database driver:

```bash
# PostgreSQL
npm install pg
npm install -D @types/pg

# MySQL / MariaDB
npm install mysql2

# SQLite
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

---

## 2. TypeScript Config

Your `tsconfig.json` must target at least ES2020 and use `moduleResolution: Bundler`
(or `NodeNext` with `"type": "module"` in package.json):

```jsonc
// tsconfig.json (recommended)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

---

## 3. Create a Config File

Create `db-migrate.config.ts` in your project root:

### PostgreSQL

```typescript
// db-migrate.config.ts
import { defineConfig, createPostgresAdapter } from "db-migrate-ts";
import { z } from "zod";

export default defineConfig({
  adapter: "postgres",
  connection: await createPostgresAdapter(process.env.DATABASE_URL!),
  migrationsDir: "./migrations",

  schema: {
    users: {
      id:        { schema: z.string().uuid(), primaryKey: true, default: "gen_random_uuid()" },
      email:     { schema: z.string().email().max(254), unique: true },
      name:      { schema: z.string().max(100) },
      createdAt: { schema: z.date(), default: "NOW()" },
    },
  },
});
```

### MySQL

```typescript
import { defineConfig, createMySQLAdapter } from "db-migrate-ts";

export default defineConfig({
  adapter: "mysql",
  connection: await createMySQLAdapter(process.env.DATABASE_URL!),
  migrationsDir: "./migrations",
});
```

### SQLite

```typescript
import { defineConfig, createSQLiteAdapter } from "db-migrate-ts";

export default defineConfig({
  adapter: "sqlite",
  connection: await createSQLiteAdapter("./app.db"),
  migrationsDir: "./migrations",
});

// In-memory (useful for tests)
// connection: await createSQLiteAdapter(":memory:")
```

---

## 4. Generate Your First Migration

```bash
npx db-migrate-ts generate create_users_table --template table
```

This creates:

```
migrations/
└── 20241215143025_create_users_table.ts
```

---

## 5. Edit the Migration

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
    migrate.dropIndex("idx_users_email", { ifExists: true });
    migrate.dropTable("users", { ifExists: true });
  },
} satisfies Migration;
```

---

## 6. Run Migrations

```bash
npx db-migrate-ts up
```

Output:

```
⚡ db-migrate-ts — running migrations

  → 20241215143025_create_users_table  ✓ (48ms)

✅ 1 migration applied successfully.
```

---

## 7. Check Status

```bash
npx db-migrate-ts status
```

```
┌─────────────────────────────────────────┬──────────────┬────────────────────────┐
│ Migration                               │ Status       │ Executed At            │
├─────────────────────────────────────────┼──────────────┼────────────────────────┤
│ 20241215143025_create_users_table       │ ✅ executed  │ 2024-12-15 14:31:02    │
└─────────────────────────────────────────┴──────────────┴────────────────────────┘
```

---

## 8. Roll Back

```bash
# Roll back the last 1 migration
npx db-migrate-ts down

# Roll back the last 3
npx db-migrate-ts down --steps 3
```

---

## 9. Project Structure

```
your-project/
├── db-migrate.config.ts        ← Config file
├── migrations/
│   ├── 20241215143025_create_users_table.ts
│   ├── 20241216090000_create_posts_table.ts
│   └── snapshots/              ← Auto-generated SQL snapshots (if enabled)
├── package.json
└── tsconfig.json
```

---

## Next Steps

- [Configuration reference →](./02-configuration.md)
- [Writing migrations →](./03-writing-migrations.md)
- [Full Builder API →](./04-migration-builder-api.md)
- [CLI commands →](./05-cli-reference.md)
