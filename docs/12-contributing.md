# Contributing

Thank you for your interest in contributing to `db-migrate-ts`!

---

## Prerequisites

- **Node.js** ≥ 18.0.0
- **pnpm** ≥ 8.0.0
- **TypeScript** knowledge (strictly typed codebase)
- A running PostgreSQL or SQLite instance for integration tests

---

## Repository Setup

```bash
git clone https://github.com/db-migrate-ts/db-migrate-ts.git
cd db-migrate-ts
pnpm install
pnpm build
```

### Monorepo Structure

```
db-migrate-ts/
├── packages/
│   ├── core/          ← Main library
│   │   ├── src/
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   └── integration/
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts
│   │   └── package.json
│   └── cli/           ← CLI tool
│       ├── src/
│       ├── tsconfig.json
│       ├── tsup.config.ts
│       └── package.json
├── examples/
│   └── with-postgres/
├── docs/              ← Documentation (this directory)
├── package.json       ← Monorepo root
├── pnpm-workspace.yaml
└── turbo.json
```

---

## Development Workflow

### Build

```bash
# Build all packages
pnpm build

# Build only core
pnpm --filter db-migrate-ts build

# Watch mode (rebuild on file changes)
pnpm dev
```

### Type Check

```bash
# Type check all packages
pnpm typecheck

# Type check only core
pnpm --filter db-migrate-ts typecheck
```

### Tests

```bash
# Run all unit tests
pnpm test

# Run unit tests in watch mode
pnpm --filter db-migrate-ts test:watch

# Run integration tests (requires a running database)
DATABASE_URL=postgresql://localhost/test_db pnpm test:integration

# Run with coverage
pnpm --filter db-migrate-ts test:coverage
```

### Lint

```bash
pnpm lint
```

---

## Code Style

- **Strict TypeScript**: all code must pass `tsc --noEmit` with no errors
- **No `any`**: use `unknown` and narrow types properly
- **JSDoc comments** on all public APIs — single-line for properties, multi-line for methods
- **`export type`** for type-only exports (required by `verbatimModuleSyntax`)
- **No `Container(color:)`** ... just kidding, wrong project :)

### Import Style

All imports in `src/` use `.js` extension (required for NodeNext compatibility):

```typescript
// ✅ Correct
import { SchemaValidator } from "./schema/schema-validator.js";

// ❌ Wrong (no extension)
import { SchemaValidator } from "./schema/schema-validator";
```

---

## Adding a New Dialect

1. Create `packages/core/src/dialects/my-dialect.dialect.ts`
2. Extend `BaseDialectAdapter`
3. Implement `columnTypeToSQL()`, `buildCreateTable()`, etc.
4. Export from `packages/core/src/dialects/index.ts`
5. Export from `packages/core/src/index.ts`
6. Add to `tsup.config.ts` entry points
7. Add `"./dialects/my-dialect"` to `package.json` exports
8. Add unit tests in `tests/unit/dialects/`
9. Add integration tests in `tests/integration/`

---

## Adding a Builder Method

1. Add the method signature to `MigrationBuilder` interface in `types/migration.types.ts`
2. Add the operation to `MigrationOperation` union type
3. Implement in `migration/migration-builder.ts` (push operation to `_ops`)
4. Handle in each dialect's SQL builder
5. Add unit tests in `tests/unit/migration/migration-builder.test.ts`

---

## Pull Request Guidelines

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feat/my-new-feature
   ```

2. **Write tests** for your changes — unit tests are mandatory, integration
   tests for anything touching the database.

3. **Run the full suite:**
   ```bash
   pnpm build && pnpm typecheck && pnpm test && pnpm lint
   ```

4. **Commit** with conventional commit format:
   ```
   feat(core): add createView() builder method
   fix(sqlite): handle ALTER COLUMN for nullable change
   docs: add SQLite WAL mode example
   test(postgres): add integration test for partial indexes
   chore(deps): bump typescript to 5.4.0
   ```

5. **Open a PR** with:
   - A clear description of what changed and why
   - Links to any related issues
   - Screenshots/output if relevant

---

## Versioning

This project uses [Changesets](https://github.com/changesets/changesets).

When you make a change that should be released:

```bash
# Create a changeset (describes what changed)
pnpm changeset

# This opens an interactive prompt:
# → Select affected packages
# → Choose patch / minor / major bump
# → Write a summary of the change
```

Then commit the generated `.changeset/*.md` file with your PR.

Maintainers run `pnpm version-packages` and `pnpm publish-packages` on release.

---

## Reporting Bugs

Please include:
1. **Node.js version** (`node --version`)
2. **pnpm version** (`pnpm --version`)
3. **Database and version** (e.g. PostgreSQL 16.1)
4. **Minimal reproduction** (ideally a single migration file + config)
5. **Full error output** with stack trace

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
