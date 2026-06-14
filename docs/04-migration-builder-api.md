# Migration Builder API

The `MigrationBuilder` is the fluent API you use inside `up()` and `down()` functions.
All methods return `this` for chaining, and table/column names are validated against
your schema type at compile time.

---

## Table Operations

### `createTable(tableName, schema)`

Creates a new table with the given column definitions.

```typescript
migrate.createTable("users", {
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
  role: {
    schema:  z.enum(["admin", "user", "moderator"]),
    default: "'user'",
  },
});
```

**Generated SQL (PostgreSQL):**
```sql
CREATE TABLE "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" VARCHAR(254) UNIQUE NOT NULL,
  "name" VARCHAR(100),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "role" TEXT NOT NULL DEFAULT 'user'
);
```

---

### `dropTable(tableName, options?)`

Drops a table. Table name is type-checked against the schema.

```typescript
migrate.dropTable("users");
migrate.dropTable("users", { ifExists: true });
migrate.dropTable("users", { cascade: true });
migrate.dropTable("users", { ifExists: true, cascade: true });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ifExists` | `boolean` | `false` | Add `IF EXISTS` — no error if missing |
| `cascade` | `boolean` | `false` | Add `CASCADE` — drop dependent objects |

---

### `renameTable(from, to)`

Renames a table. The source name is type-checked.

```typescript
migrate.renameTable("orders", "purchases");
```

---

### `truncateTable(tableName)`

Removes all rows from a table without dropping its structure.

```typescript
migrate.truncateTable("sessions");
```

> ⚠️ **Warning:** This is irreversible without a backup. Use with extreme care in `down()`.

---

## Column Operations

### `addColumn(tableName, columnName, definition)`

Adds a new column to an existing table.

```typescript
migrate.addColumn("users", "avatarUrl", {
  schema:   z.string().url(),
  nullable: true,
});

migrate.addColumn("posts", "publishedAt", {
  schema:   z.date(),
  nullable: true,
});

migrate.addColumn("orders", "total", {
  schema:  z.number(),
  default: 0,
});
```

---

### `dropColumn(tableName, columnName)`

Drops a column. Both table name and **column name** are type-checked at compile time.

```typescript
// ✅ TypeScript confirms "email" exists on "users"
migrate.dropColumn("users", "email");

// ❌ TypeScript Error: '"usr_email"' is not assignable to '"id" | "email" | "name"'
migrate.dropColumn("users", "usr_email");
```

---

### `renameColumn(tableName, from, to)`

Renames a column. The original column name is type-checked.

```typescript
// ✅ Renames "username" → "displayName" on "users"
migrate.renameColumn("users", "username", "displayName");
```

---

### `alterColumn(tableName, columnName, newDefinition)`

Modifies a column's type, constraints, or nullability.

```typescript
// Change type from VARCHAR(100) to TEXT
migrate.alterColumn("users", "name", {
  schema: z.string(), // TEXT
});

// Make a column NOT NULL
migrate.alterColumn("users", "email", {
  schema:   z.string().email(),
  nullable: false,
});
```

> **SQLite note:** SQLite doesn't support `ALTER COLUMN` natively.
> The library recreates the table using a copy strategy.

---

### `setNotNull(tableName, columnName)`

Adds a NOT NULL constraint to a column (without changing its type).

```typescript
migrate.setNotNull("users", "email");
```

---

### `dropNotNull(tableName, columnName)`

Removes the NOT NULL constraint (makes the column nullable).

```typescript
migrate.dropNotNull("users", "name");
```

---

### `setDefault(tableName, columnName, defaultValue)`

Sets or updates a column's DEFAULT value.

```typescript
migrate.setDefault("users", "role", "'user'");         // SQL expression
migrate.setDefault("orders", "total", 0);              // Numeric literal
migrate.setDefault("users", "createdAt", "NOW()");     // PostgreSQL function
```

---

### `dropDefault(tableName, columnName)`

Removes the DEFAULT value from a column.

```typescript
migrate.dropDefault("users", "role");
```

---

## Index Operations

### `createIndex(tableName, columns, options?)`

Creates an index on one or more columns.

```typescript
// Simple unique index
migrate.createIndex("users", ["email"], { unique: true });

// Composite index with custom name
migrate.createIndex("posts", ["authorId", "createdAt"], {
  name: "idx_posts_author_date",
});

// Partial index (PostgreSQL)
migrate.createIndex("orders", ["status"], {
  name:  "idx_orders_pending",
  where: "status = 'pending'",
});

// GIN index for JSONB (PostgreSQL)
migrate.createIndex("products", ["metadata"], {
  using: "gin",
  name:  "idx_products_metadata_gin",
});

// Concurrent creation (non-blocking — PostgreSQL)
migrate.createIndex("events", ["occurredAt"], {
  concurrently: true,
  name:         "idx_events_occurred_at",
});
```

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Custom index name (auto-generated if omitted) |
| `unique` | `boolean` | Create a UNIQUE index |
| `where` | `string` | Partial index WHERE condition (PostgreSQL) |
| `using` | `"btree" \| "hash" \| "gin" \| "gist" \| "brin" \| "spgist"` | Index type (PostgreSQL) |
| `concurrently` | `boolean` | Non-blocking creation (PostgreSQL) |

---

### `dropIndex(indexName, options?)`

Drops an index by name.

```typescript
migrate.dropIndex("idx_users_email");
migrate.dropIndex("idx_users_email", { ifExists: true });
migrate.dropIndex("idx_events_occurred_at", { concurrently: true });
```

---

## Constraint Operations

### `addForeignKey(tableName, columnName, references)`

Adds a foreign key constraint to an existing column.

```typescript
migrate.addForeignKey("posts", "authorId", {
  table:    "users",
  column:   "id",
  name:     "fk_posts_author",       // optional
  onDelete: "CASCADE",
  onUpdate: "NO ACTION",
});
```

| Field | Type | Description |
|-------|------|-------------|
| `table` | `string` | Referenced table |
| `column` | `string` | Referenced column |
| `name` | `string?` | Constraint name |
| `onDelete` | `"CASCADE" \| "SET NULL" \| "RESTRICT" \| "NO ACTION"` | Delete behaviour |
| `onUpdate` | `"CASCADE" \| "SET NULL" \| "RESTRICT" \| "NO ACTION"` | Update behaviour |

---

### `dropForeignKey(tableName, constraintName)`

Drops a named foreign key constraint.

```typescript
migrate.dropForeignKey("posts", "fk_posts_author");
```

---

### `addCheck(tableName, constraintName, expression)`

Adds a CHECK constraint.

```typescript
migrate.addCheck("products", "chk_price_positive", "price >= 0");
migrate.addCheck("users", "chk_age_valid", "age BETWEEN 0 AND 150");
```

---

### `dropCheck(tableName, constraintName)`

Drops a CHECK constraint.

```typescript
migrate.dropCheck("products", "chk_price_positive");
```

---

## Raw SQL Escape Hatch

### `raw(sql, bindings?)`

Executes a raw SQL statement. Use this for operations not covered by the builder.

> ⚠️ Raw SQL is **not** type-checked. Always use parameterized bindings for user input.

```typescript
// Extensions (PostgreSQL)
migrate.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
migrate.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

// Enum types (PostgreSQL)
migrate.raw(`CREATE TYPE user_role AS ENUM ('admin', 'user', 'moderator')`);

// Materialized view
migrate.raw(`
  CREATE MATERIALIZED VIEW monthly_revenue AS
  SELECT
    DATE_TRUNC('month', created_at) AS month,
    SUM(amount) AS total
  FROM orders
  GROUP BY 1
`);

// Parameterized (safe against SQL injection)
migrate.raw(
  "UPDATE users SET plan = $1 WHERE email LIKE $2",
  ["pro", "%@enterprise.com"]
);
```

---

## Chaining

All methods return `this`, so you can chain operations:

```typescript
up: async (migrate) => {
  migrate
    .createTable("categories", {
      id:   { schema: z.number().int(), primaryKey: true },
      name: { schema: z.string().max(100), unique: true },
    })
    .addColumn("posts", "categoryId", {
      schema:   z.number().int(),
      nullable: true,
    })
    .addForeignKey("posts", "categoryId", {
      table:    "categories",
      column:   "id",
      onDelete: "SET NULL",
    })
    .createIndex("posts", ["categoryId"], { name: "idx_posts_category" });
},
```
