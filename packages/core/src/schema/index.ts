/**
 * @file schema/index.ts
 * @description Re-exports all schema layer components.
 */

export { ZodToSQLConverter } from "./zod-to-sql.js";

export { SchemaRegistry, createRegistry } from "./schema-registry.js";

export { SchemaDiffer, formatDiff } from "./schema-differ.js";

export {
  SchemaValidator,
  validateSchema,
  validateSchemaOrThrow,
} from "./schema-validator.js";

export type { ValidationResult } from "./schema-validator.js";
