/**
 * @file sql-sanitizer.ts
 * @description SQL input sanitization and identifier validation utilities.
 *
 * These utilities help prevent SQL injection when incorporating user-supplied
 * values into SQL statements. Note: parameterized queries are always preferred
 * over string interpolation — use these only when parameterization isn't possible.
 */

/**
 * Validates that a string is a safe SQL identifier (table/column name).
 * Throws if the identifier contains dangerous characters.
 *
 * @param identifier - The identifier to validate
 * @param context    - Context for error messages (e.g., "table name", "column name")
 * @throws Error if the identifier is unsafe
 *
 * @example
 * validateIdentifier("users");         // ✅ OK
 * validateIdentifier("user_emails");   // ✅ OK
 * validateIdentifier("users; DROP --"); // ❌ Throws
 */
export function validateIdentifier(identifier: string, context = "identifier"): void {
  if (!identifier || typeof identifier !== "string") {
    throw new Error(
      `[db-migrate-ts] Invalid ${context}: expected a non-empty string, ` +
        `got ${typeof identifier}`
    );
  }

  if (identifier.length > 128) {
    throw new Error(
      `[db-migrate-ts] ${context} "${identifier}" is too long. ` +
        `Maximum length is 128 characters.`
    );
  }

  // Only allow valid SQL identifiers: letters, numbers, underscores
  // Quoted identifiers with spaces are handled by the dialect's quoteIdentifier
  const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
  if (!SAFE_IDENTIFIER.test(identifier)) {
    throw new Error(
      `[db-migrate-ts] Unsafe ${context}: "${identifier}". ` +
        `Use only letters, numbers, underscores, and dollar signs. ` +
        `Must start with a letter or underscore.`
    );
  }
}

/**
 * Sanitizes a string value for use in a SQL LIKE clause.
 * Escapes %, _, and \ characters.
 *
 * @example
 * sanitizeLike("50% off")  // → "50\\% off"
 * sanitizeLike("foo_bar")  // → "foo\\_bar"
 */
export function sanitizeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Escapes a string value for safe inclusion in a SQL string literal.
 * Doubles single quotes to prevent SQL injection.
 *
 * ⚠️ ALWAYS prefer parameterized queries over this function.
 * Only use this for rare cases where parameterization isn't available.
 *
 * @example
 * escapeString("O'Brien")   // → "O''Brien"
 * escapeString("it's here") // → "it''s here"
 */
export function escapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Validates multiple identifiers at once (e.g., a list of column names).
 *
 * @throws on the first invalid identifier found
 */
export function validateIdentifiers(
  identifiers: string[],
  context = "identifier"
): void {
  for (const id of identifiers) {
    validateIdentifier(id, context);
  }
}

/**
 * Checks if a string appears to contain a SQL injection attempt.
 * Used as an extra layer of safety for raw SQL inputs.
 *
 * Note: This is NOT a complete SQL injection prevention mechanism.
 * Always use parameterized queries as the primary defense.
 */
export function detectSQLInjection(input: string): boolean {
  const INJECTION_PATTERNS = [
    /;\s*(DROP|DELETE|UPDATE|INSERT|ALTER|CREATE|TRUNCATE)\s/i,
    /--\s/,
    /\/\*[\s\S]*?\*\//,
    /\bUNION\s+(?:ALL\s+)?SELECT\b/i,
    /\bOR\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i,
    /\bAND\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?/i,
    /\bXP_CMDSHELL\b/i,
    /\bEXEC\s*\(/i,
  ];

  return INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * Validates a migration name for use as a file name.
 * Migration names follow the format: {timestamp}_{description}
 *
 * @example
 * validateMigrationName("20241215120000_create_users"); // ✅
 * validateMigrationName("my migration!");              // ❌
 */
export function validateMigrationName(name: string): void {
  const VALID_MIGRATION_NAME = /^\d{14}_[a-z][a-z0-9_]*$/;
  if (!VALID_MIGRATION_NAME.test(name)) {
    throw new Error(
      `[db-migrate-ts] Invalid migration name: "${name}". ` +
        `Expected format: {14-digit timestamp}_{snake_case_description} ` +
        `(e.g., "20241215120000_create_users_table")`
    );
  }
}
