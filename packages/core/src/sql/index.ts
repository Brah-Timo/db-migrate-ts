/**
 * @file sql/index.ts
 * @description Re-exports all SQL layer components.
 */

export { SqlBuilder } from "./sql-builder.js";
export { formatSQL, formatSQLFile, highlightSQL } from "./sql-formatter.js";
export {
  validateIdentifier,
  validateIdentifiers,
  sanitizeLike,
  escapeString,
  detectSQLInjection,
  validateMigrationName,
} from "./sql-sanitizer.js";
