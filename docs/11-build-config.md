# Build Configuration

This document explains the build setup for the `db-migrate-ts` monorepo and the
fixes applied to resolve TypeScript DTS build errors.

---

## Build Stack

| Tool | Purpose |
|------|---------|
| **tsup** | Bundles TypeScript source → CJS (`.js`) + ESM (`.mjs`) + `.d.ts` type declarations |
| **Turborepo** | Orchestrates builds across packages in the monorepo |
| **pnpm** | Package manager with workspace support |
| **TypeScript 5.x** | Type checking and declaration generation |

---

## The Build Errors (and Fixes)

### Error 1: `TS1295` — `verbatimModuleSyntax` + NodeNext conflict

**Error message:**
```
src/index.ts(23,10): error TS1295: ECMAScript imports and exports cannot be written
in a CommonJS file under 'verbatimModuleSyntax'. Adjust the 'type' field in the
nearest 'package.json' to make this file an ECMAScript module, or adjust your
'verbatimModuleSyntax', 'module', and 'moduleResolution' settings in TypeScript.
```

**Root cause:**

The original `tsconfig.json` had:
```jsonc
{
  "module": "NodeNext",
  "moduleResolution": "NodeNext",
  "verbatimModuleSyntax": true
}
```

When `module` is set to `NodeNext`, TypeScript determines the module format of each
`.ts` file by looking at the nearest `package.json`. If that `package.json` does **not**
have `"type": "module"`, TypeScript treats all `.ts` files as CommonJS — and then
`verbatimModuleSyntax: true` forbids using `import`/`export` syntax in CommonJS files.

`packages/core/package.json` was missing `"type": "module"`.

**Fix applied:**

Changed `tsconfig.json` to use `Preserve` / `Bundler`:

```jsonc
// packages/core/tsconfig.json — AFTER FIX
{
  "compilerOptions": {
    "module": "Preserve",           // ← was "NodeNext"
    "moduleResolution": "Bundler",  // ← was "NodeNext"
    "verbatimModuleSyntax": true    // ← kept as-is
  }
}
```

**Why `Preserve` + `Bundler`?**

- `module: "Preserve"` tells TypeScript to leave the module syntax as-is
  (neither CommonJS nor ESM transformation). tsup handles the output format.
- `moduleResolution: "Bundler"` enables modern resolution without requiring
  `.js` extensions in source while keeping the existing `.js` extensions working.
- `verbatimModuleSyntax: true` is preserved — it's a useful safety rule that
  ensures `import type` is used for type-only imports (helps tree-shaking).
- This combination works for dual CJS+ESM libraries built with tsup.

**Alternative fix** (also valid):

Add `"type": "module"` to `packages/core/package.json`:
```json
{
  "name": "db-migrate-ts",
  "type": "module"
}
```
This tells Node.js and TypeScript that all `.ts`/`.js` files in this package are
ES modules. This fix was also applied (see Error 2 below).

---

### Error 2: `[WARNING]` — `"types"` condition after `"import"` and `"require"`

**Warning message:**
```
▲ [WARNING] The condition "types" here will never be used as it comes after
  both "import" and "require" [package.json]

    package.json:24:6:
      24 │       "types": "./dist/index.d.ts"
```

**Root cause:**

In `package.json`'s `exports` field, condition order matters. TypeScript's `moduleResolution: "Bundler"`
checks `"types"` first. If `"types"` is listed _after_ `"import"` and `"require"`, bundlers
(and TypeScript itself) may pick `"import"` before reaching `"types"`, which means the
`.d.ts` declarations are sometimes silently ignored.

Original (broken order):
```json
"exports": {
  ".": {
    "import": "./dist/index.mjs",
    "require": "./dist/index.js",
    "types":   "./dist/index.d.ts"   ← WRONG: comes last
  }
}
```

**Fix applied:**

```json
"exports": {
  ".": {
    "types":   "./dist/index.d.ts",  ← CORRECT: must be first
    "import":  "./dist/index.mjs",
    "require": "./dist/index.js"
  }
}
```

This was fixed for all four exports entries (`.`, `./dialects/postgres`, `./dialects/mysql`, `./dialects/sqlite`).

**Rule:** Always put `"types"` before `"import"` and `"require"` in `exports`.

---

## Final File States

### `packages/core/tsconfig.json` (after fix)

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests", "**/*.test.ts", "**/*.spec.ts"]
}
```

### `packages/core/package.json` (key changes)

```json
{
  "name": "db-migrate-ts",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types":   "./dist/index.d.ts",
      "import":  "./dist/index.mjs",
      "require": "./dist/index.js"
    },
    "./dialects/postgres": {
      "types":   "./dist/dialects/postgres.dialect.d.ts",
      "import":  "./dist/dialects/postgres.dialect.mjs",
      "require": "./dist/dialects/postgres.dialect.js"
    },
    "./dialects/mysql": {
      "types":   "./dist/dialects/mysql.dialect.d.ts",
      "import":  "./dist/dialects/mysql.dialect.mjs",
      "require": "./dist/dialects/mysql.dialect.js"
    },
    "./dialects/sqlite": {
      "types":   "./dist/dialects/sqlite.dialect.d.ts",
      "import":  "./dist/dialects/sqlite.dialect.mjs",
      "require": "./dist/dialects/sqlite.dialect.js"
    }
  }
}
```

---

## tsup Configuration

`packages/core/tsup.config.ts` controls how the source is compiled:

```typescript
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index:                    "src/index.ts",
      "dialects/postgres.dialect": "src/dialects/postgres.dialect.ts",
      "dialects/mysql.dialect":    "src/dialects/mysql.dialect.ts",
      "dialects/sqlite.dialect":   "src/dialects/sqlite.dialect.ts",
    },
    format:    ["cjs", "esm"],  // Generates .js (CJS) + .mjs (ESM)
    dts:       true,            // Generates .d.ts type declarations
    sourcemap: true,
    clean:     true,
    splitting: false,
    treeshake: true,
    target:    "node18",
    platform:  "node",
    outDir:    "dist",
    external:  ["pg", "mysql2", "better-sqlite3", "zod"],
  },
]);
```

---

## Running the Build

```bash
# From monorepo root — builds all packages
pnpm build

# Build only core
cd packages/core
pnpm build

# Build with watch mode (development)
pnpm dev
```

### Expected Output (clean build)

```
db-migrate-ts:build: ESM dist/dialects/postgres.dialect.mjs   5.25 KB
db-migrate-ts:build: ESM dist/dialects/sqlite.dialect.mjs     4.87 KB
db-migrate-ts:build: ESM dist/dialects/mysql.dialect.mjs      4.24 KB
db-migrate-ts:build: ESM dist/index.mjs                       99.80 KB
db-migrate-ts:build: ESM ⚡️ Build success
db-migrate-ts:build: CJS dist/index.js                        101.98 KB
db-migrate-ts:build: CJS ⚡️ Build success
db-migrate-ts:build: DTS ⚡️ Build success       ← no more errors!
```

---

## Consumer tsconfig Recommendations

Projects consuming `db-migrate-ts` should use at minimum:

```jsonc
{
  "compilerOptions": {
    "moduleResolution": "Bundler",  // or "NodeNext"
    "target":           "ES2020",   // or higher
    "strict":           true
  }
}
```

For Next.js:
```jsonc
{
  "compilerOptions": {
    "moduleResolution": "Bundler",
    "module":           "ESNext"
  }
}
```

For plain Node.js with ESM:
```jsonc
{
  "compilerOptions": {
    "module":           "NodeNext",
    "moduleResolution": "NodeNext"
  }
}
```
Add `"type": "module"` in `package.json` when using `NodeNext`.
