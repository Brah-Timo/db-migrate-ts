# Type Safety

One of `db-migrate-ts`'s core features is catching migration mistakes at TypeScript
compile time — before they reach your database.

---

## The Problem it Solves

```typescript
// ❌ Old way (Knex / raw SQL) — runtime crash on production
await knex.schema.table("users", (t) => {
  t.dropColumn("usr_email"); // Typo: column is "email", not "usr_email"
  // → Crashes at runtime: column "usr_email" does not exist
});
```

```typescript
// ✅ db-migrate-ts — TypeScript error at write-time
migrate.dropColumn("users", "usr_email");
//                           ^^^^^^^^^
// TypeScript Error: Argument of type '"usr_email"' is not assignable to
// parameter of type '"id" | "email" | "name" | "createdAt"'
```

---

## How It Works

### 1. Define Your Schema

```typescript
// schema.ts
import { z } from "zod";
import type { DatabaseSchema } from "db-migrate-ts";

export const AppDB = {
  users: {
    id:        { schema: z.string().uuid(), primaryKey: true },
    email:     { schema: z.string().email() },
    name:      { schema: z.string().max(100) },
    createdAt: { schema: z.date() },
  },
  posts: {
    id:       { schema: z.number().int(), primaryKey: true },
    title:    { schema: z.string().max(255) },
    authorId: { schema: z.string().uuid() },
  },
} satisfies DatabaseSchema;

export type AppDB = typeof AppDB;
```

### 2. Pass the Type to Migrations

```typescript
// migrations/20241215120000_example.ts
import type { Migration } from "db-migrate-ts";
import type { AppDB } from "../schema.js";

export default {
  name: "20241215120000_example",
  timestamp: 20241215120000,

  up: async (migrate) => {
    // ✅ "users" exists in AppDB → valid
    migrate.dropColumn("users", "name");

    // ❌ TypeScript Error: '"orders"' is not assignable to '"users" | "posts"'
    migrate.dropTable("orders");

    // ❌ TypeScript Error: '"usr_email"' is not a column of "users"
    migrate.dropColumn("users", "usr_email");
  },

  down: async (migrate) => { /* ... */ },
} satisfies Migration<AppDB>;
```

---

## Validated Operations

The following operations validate **table names** AND/OR **column names**:

| Method | Table Name | Column Name |
|--------|:---:|:---:|
| `dropTable(table)` | ✅ | — |
| `renameTable(from, to)` | ✅ (from) | — |
| `truncateTable(table)` | ✅ | — |
| `addColumn(table, col, def)` | ✅ | — |
| `dropColumn(table, col)` | ✅ | ✅ |
| `renameColumn(table, from, to)` | ✅ | ✅ (from) |
| `alterColumn(table, col, def)` | ✅ | ✅ |
| `setNotNull(table, col)` | ✅ | ✅ |
| `dropNotNull(table, col)` | ✅ | ✅ |
| `setDefault(table, col, val)` | ✅ | ✅ |
| `dropDefault(table, col)` | ✅ | ✅ |
| `createIndex(table, cols, opts)` | ✅ | ✅ (cols[]) |
| `addForeignKey(table, col, ref)` | ✅ | — |
| `dropForeignKey(table, name)` | ✅ | — |
| `addCheck(table, name, expr)` | ✅ | — |
| `dropCheck(table, name)` | ✅ | — |

`createTable` and `raw` are not type-checked — they accept `string`.

---

## Schema Types

### `DatabaseSchema`

The top-level type for a schema definition:

```typescript
import type { DatabaseSchema } from "db-migrate-ts";

// A schema is a Record<tableName, Record<columnName, ColumnDefinition>>
const mySchema = {
  users: {
    id:    { schema: z.string().uuid(), primaryKey: true },
    email: { schema: z.string().email() },
  },
} satisfies DatabaseSchema;
```

### `TableName<TDb>`

Extract valid table names from a schema:

```typescript
import type { TableName } from "db-migrate-ts";

type Tables = TableName<AppDB>;
// → "users" | "posts"
```

### `ColumnName<TDb, TTable>`

Extract valid column names for a specific table:

```typescript
import type { ColumnName } from "db-migrate-ts";

type UserColumns = ColumnName<AppDB, "users">;
// → "id" | "email" | "name" | "createdAt"
```

---

## Row Type Inference

Use `InferTableType` to get the TypeScript type for rows returned from a table:

```typescript
import type { InferTableType } from "db-migrate-ts";

// Infer the full row type
type UserRow = InferTableType<typeof AppDB.users>;
// → { id: string; email: string; name: string; createdAt: Date }

// Infer insert type (required columns only, nullable columns are optional)
import type { InsertType } from "db-migrate-ts";
type InsertUser = InsertType<typeof AppDB.users>;
// → { id: string; email: string; name?: string | null; createdAt?: Date }

// Infer update type (all columns optional)
import type { UpdateType } from "db-migrate-ts";
type UpdateUser = UpdateType<typeof AppDB.users>;
// → { id?: string; email?: string; name?: string | null; createdAt?: Date }

// Select type (all columns)
import type { SelectType } from "db-migrate-ts";
type SelectUser = SelectType<typeof AppDB.users>;
// → { id: string; email: string; name: string | null; createdAt: Date }
```

### Using with a Query Client

```typescript
const users = await db.query<UserRow>("SELECT * FROM users WHERE id = $1", [userId]);
//    ^^^^^ → typed as UserRow[]

users[0]?.email;   // ✅ TypeScript knows this is string
users[0]?.unknown; // ❌ TypeScript Error: property 'unknown' does not exist
```

---

## Schema Registry

The `SchemaRegistry` collects your schema for runtime access:

```typescript
import { createRegistry } from "db-migrate-ts";

const registry = createRegistry(AppDB);

// Get all table names
const tables = registry.getTableNames();
// → ["users", "posts"]

// Get column names for a table
const columns = registry.getColumnNames("users");
// → ["id", "email", "name", "createdAt"]

// Get a specific column definition
const emailDef = registry.getColumn("users", "email");
// → { schema: ZodString, nullable: false, ... }
```

---

## Schema Validation

`defineConfig()` validates your schema at startup using `SchemaValidator`.
Errors throw immediately; warnings are printed:

```typescript
// ❌ Runtime error at startup
defineConfig({
  schema: {
    users: {}, // Empty table → throws
  }
});

// ✅ Warning printed, but continues
defineConfig({
  schema: {
    users: {
      id: { schema: z.string().uuid(), primaryKey: true },
      // No other columns → warning
    },
  }
});
```

---

## SchemaDiffer

Detect changes between two schema versions:

```typescript
import { SchemaDiffer, formatDiff } from "db-migrate-ts";

const differ = new SchemaDiffer();
const diff = differ.diff(oldSchema, newSchema);

// diff.added   → tables/columns added in newSchema
// diff.removed → tables/columns removed from oldSchema
// diff.changed → columns whose definitions changed

console.log(formatDiff(diff));
```

This is particularly useful for generating migrations automatically from schema changes.

---

## When Type-Safety Doesn't Apply

- `createTable()` — table name is not yet in the schema type
- `raw()` — raw SQL is never type-checked
- `addColumn()` — column name is new, not yet in schema
- `renameTable(from, to)` — only `from` is checked; `to` is `string`
- `renameColumn(table, from, to)` — only `from` is checked; `to` is `string`

This is intentional. You can't statically type operations that create new things.
