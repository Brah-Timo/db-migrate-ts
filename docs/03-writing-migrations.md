# Writing Migrations

---

## Migration File Format

Every migration file must export a default object implementing the `Migration` interface:

```typescript
import type { Migration } from "db-migrate-ts";

export default {
  name:      "20241215120000_create_users_table",
  timestamp: 20241215120000,

  up: async (migrate) => {
    // Apply schema changes
  },

  down: async (migrate) => {
    // Reverse the changes (rollback)
  },
} satisfies Migration;
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | ✅ | Unique identifier — must match the filename |
| `timestamp` | `number` | ✅ | `YYYYMMDDHHMMSS` as a number |
| `up` | `function` | ✅ | Apply the migration |
| `down` | `function` | ✅ | Reverse the migration |
| `description` | `string` | ❌ | Human-readable description |

---

## Naming Convention

```
{YYYYMMDDHHMMSS}_{snake_case_description}.ts

Examples:
  20241215120000_create_users_table.ts
  20241216090000_create_posts_table.ts
  20241217143025_add_avatar_to_users.ts
  20241218080000_drop_legacy_sessions_table.ts
```

Use the CLI to generate correctly-named files:

```bash
npx db-migrate-ts generate create_products_table --template table
npx db-migrate-ts generate add_phone_to_users    --template column
npx db-migrate-ts generate custom_logic           --template blank
```

---

## Migration Templates

### Blank Template

```typescript
import type { Migration } from "db-migrate-ts";

export default {
  name:      "20241215120000_my_migration",
  timestamp: 20241215120000,
  up:   async (_migrate) => {},
  down: async (_migrate) => {},
} satisfies Migration;
```

### Table Template

```typescript
import type { Migration } from "db-migrate-ts";
import { z } from "zod";

export default {
  name:      "20241215120000_create_products_table",
  timestamp: 20241215120000,

  up: async (migrate) => {
    migrate.createTable("products", {
      id: {
        schema:     z.number().int(),
        primaryKey: true,
      },
      name: {
        schema: z.string().max(255),
      },
      price: {
        schema:   z.number(),
        nullable: true,
      },
      createdAt: {
        schema:  z.date(),
        default: "NOW()",
      },
    });
  },

  down: async (migrate) => {
    migrate.dropTable("products", { ifExists: true });
  },
} satisfies Migration;
```

### Column Template

```typescript
import type { Migration } from "db-migrate-ts";
import { z } from "zod";

export default {
  name:      "20241215120000_add_avatar_to_users",
  timestamp: 20241215120000,

  up: async (migrate) => {
    migrate.addColumn("users", "avatarUrl", {
      schema:   z.string().url(),
      nullable: true,
    });
  },

  down: async (migrate) => {
    migrate.dropColumn("users", "avatarUrl");
  },
} satisfies Migration;
```

---

## Type-Safe Migrations

When you define a `schema` in your config, pass the schema type to `Migration<T>`:

```typescript
// types/db-schema.ts
import { z } from "zod";
import type { DatabaseSchema } from "db-migrate-ts";

export const MyDB = {
  users: {
    id:    { schema: z.string().uuid(), primaryKey: true },
    email: { schema: z.string().email() },
    name:  { schema: z.string().max(100) },
  },
  posts: {
    id:       { schema: z.number().int(), primaryKey: true },
    title:    { schema: z.string().max(255) },
    authorId: { schema: z.string().uuid() },
  },
} satisfies DatabaseSchema;

export type MyDB = typeof MyDB;
```

```typescript
// migrations/20241215120000_rename_column.ts
import type { Migration } from "db-migrate-ts";
import type { MyDB } from "../types/db-schema.js";

export default {
  name:      "20241215120000_rename_column",
  timestamp: 20241215120000,

  up: async (migrate: Parameters<Migration<MyDB>["up"]>[0]) => {
    // ✅ TypeScript validates "email" exists on "users"
    migrate.renameColumn("users", "email", "emailAddress");

    // ❌ TypeScript Error — "usr_email" doesn't exist
    // migrate.dropColumn("users", "usr_email");
  },

  down: async (migrate) => {
    migrate.renameColumn("users", "emailAddress", "email");
  },
} satisfies Migration<MyDB>;
```

---

## Complex Migration Examples

### Multiple Operations

```typescript
up: async (migrate) => {
  // Step 1: Create new table
  migrate.createTable("categories", {
    id:   { schema: z.number().int(), primaryKey: true },
    name: { schema: z.string().max(100), unique: true },
    slug: { schema: z.string().max(100), unique: true },
  });

  // Step 2: Add foreign key column to existing table
  migrate.addColumn("posts", "categoryId", {
    schema:     z.number().int(),
    nullable:   true,
    references: { table: "categories", column: "id", onDelete: "SET NULL" },
  });

  // Step 3: Create indexes
  migrate.createIndex("posts", ["categoryId"], { name: "idx_posts_category" });
},
```

### Raw SQL Escape Hatch

```typescript
up: async (migrate) => {
  // PostgreSQL extensions
  migrate.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // Enum types (PostgreSQL)
  migrate.raw(`CREATE TYPE user_role AS ENUM ('admin', 'user', 'moderator')`);

  // Complex UPDATE with parameterized bindings
  migrate.raw(
    "UPDATE users SET role = $1 WHERE email LIKE $2",
    ["admin", "%@company.com"]
  );
},

down: async (migrate) => {
  migrate.raw("DROP TYPE IF EXISTS user_role");
},
```

### Data Migration

```typescript
up: async (migrate) => {
  // Schema change
  migrate.addColumn("users", "fullName", {
    schema:   z.string().max(200),
    nullable: true,
  });

  // Data migration — backfill from existing columns
  migrate.raw(
    "UPDATE users SET full_name = CONCAT(first_name, ' ', last_name)"
  );

  // Make it NOT NULL after backfill
  migrate.setNotNull("users", "fullName");

  // Remove old columns
  migrate.dropColumn("users", "firstName");
  migrate.dropColumn("users", "lastName");
},
```

---

## Rules and Best Practices

### ✅ DO

- **Always write a `down` function** that exactly reverses `up`
- **Never edit a migration** after it has run on any environment
- **Use timestamps from the current time** — don't reuse or rename files
- **Test both `up` and `down`** with `validate` and dry-run
- **Keep migrations focused** — one logical change per file
- **Wrap destructive changes** — use `ifExists: true` in `down`

### ❌ DON'T

- Don't rename migration files after they've been executed
- Don't delete migration files that have already run
- Don't edit the `name` or `timestamp` fields after execution
- Don't mix DDL and complex DML in the same migration when possible

---

## Execution Model

Each migration's `up` (or `down`) function is:
1. Compiled to SQL by `MigrationBuilderImpl`
2. Wrapped in a **transaction** (auto-rollback on failure)
3. Executed as a single atomic unit
4. Recorded in the `__db_migrations` table with a SHA-256 checksum

If a migration fails partway through, the entire transaction is rolled back — leaving
the database in the state it was before the migration started.
