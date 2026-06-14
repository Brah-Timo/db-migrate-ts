# db-migrate-ts — Documentation Overview

**Type-safe database migrations powered by Zod and TypeScript**

---

## Documentation Index

| File | Topic |
|------|-------|
| [00-overview.md](./00-overview.md) | This index — what's in each doc |
| [01-getting-started.md](./01-getting-started.md) | Installation, first migration, quick start |
| [02-configuration.md](./02-configuration.md) | `defineConfig`, all config options, adapters |
| [03-writing-migrations.md](./03-writing-migrations.md) | Migration file format, naming, `up`/`down` |
| [04-migration-builder-api.md](./04-migration-builder-api.md) | Full builder API — every method documented |
| [05-cli-reference.md](./05-cli-reference.md) | All CLI commands, flags, examples |
| [06-adapters.md](./06-adapters.md) | PostgreSQL, MySQL, SQLite adapters |
| [07-zod-to-sql.md](./07-zod-to-sql.md) | Zod → SQL type mapping tables |
| [08-type-safety.md](./08-type-safety.md) | How type safety works, schema types, inference |
| [09-programmatic-api.md](./09-programmatic-api.md) | Using `MigrationRunner`, `RollbackManager` in code |
| [10-error-reference.md](./10-error-reference.md) | All error classes, codes, handling strategies |
| [11-build-config.md](./11-build-config.md) | tsup, tsconfig, package.json — build setup explained |
| [12-contributing.md](./12-contributing.md) | Development setup, testing, PR guidelines |

---

## What is db-migrate-ts?

`db-migrate-ts` is a lightweight (~12KB gzipped), ORM-free database migration library
that brings TypeScript type safety to every DDL operation. Instead of writing plain
string-based migrations and discovering typos at runtime on production, you get:

- **Compile-time validation** of table names and column names
- **Zod-powered** column type definitions with automatic SQL type inference
- **Multi-dialect** support: PostgreSQL, MySQL, SQLite
- **Full rollback** support with step count or target migration
- **Checksum validation** to detect tampered migration files
- **CLI** for all common operations

---

## Why not Prisma / Knex / TypeORM?

| | db-migrate-ts | Prisma Migrate | Knex.js | TypeORM |
|---|:---:|:---:|:---:|:---:|
| Type-safe table names | ✅ | ✅ | ❌ | ⚠️ |
| Type-safe column names | ✅ | ✅ | ❌ | ⚠️ |
| Zod integration | ✅ | ❌ | ❌ | ❌ |
| ORM-free | ✅ | ❌ | ✅ | ❌ |
| Bundle size | ~12KB | ~5MB | ~800KB | ~2MB |
| Rollback | ✅ | ⚠️ | ✅ | ✅ |

---

## Architecture

```
db-migrate-ts/
├── packages/
│   ├── core/                 ← Main library (MIT)
│   │   ├── src/types/        ← Type system (column, table, migration, dialect)
│   │   ├── src/schema/       ← Zod→SQL converter, registry, differ, validator
│   │   ├── src/migration/    ← Builder, runner, tracker, rollback manager
│   │   ├── src/sql/          ← SQL builder, formatter, sanitizer
│   │   └── src/dialects/     ← PostgreSQL, MySQL, SQLite adapters
│   └── cli/                  ← CLI tool (MIT)
├── examples/
│   └── with-postgres/        ← Example project
└── docs/                     ← This documentation
```
