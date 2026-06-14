/**
 * @file sql-formatter.ts
 * @description SQL statement formatter for readable output (snapshots, dry-run, GUI).
 *
 * Formats raw SQL statements with proper indentation and keyword capitalization
 * for display in CLI output and SQL snapshot files.
 */

/**
 * Formats a single SQL statement for human-readable output.
 * Handles basic keyword indentation for common DDL statements.
 *
 * @example
 * formatSQL("CREATE TABLE users (id INTEGER NOT NULL, name TEXT NOT NULL)")
 * // →
 * // CREATE TABLE "users" (
 * //   id INTEGER NOT NULL,
 * //   name TEXT NOT NULL
 * // )
 */
export function formatSQL(sql: string): string {
  const trimmed = sql.trim();

  // Already has newlines — return as-is
  if (trimmed.includes("\n")) {
    return trimmed;
  }

  // CREATE TABLE — expand columns to separate lines
  const createTableMatch = /^(CREATE TABLE\s+\S+\s*)\((.+)\)$/i.exec(trimmed);
  if (createTableMatch) {
    const [, header, body] = createTableMatch as unknown as [string, string, string];
    const columns = splitTopLevel(body, ",");
    return `${header.trim()} (\n${columns.map((c) => `  ${c.trim()}`).join(",\n")}\n)`;
  }

  // Keep other statements as-is (they're single-line DDL)
  return trimmed;
}

/**
 * Formats an array of SQL statements as a readable SQL file string.
 * Each statement ends with a semicolon and is separated by a blank line.
 *
 * @example
 * formatSQLFile(["CREATE TABLE users (...)", "CREATE INDEX ..."])
 * // →
 * // CREATE TABLE "users" (
 * //   ...
 * // );
 * //
 * // CREATE INDEX ...;
 */
export function formatSQLFile(statements: string[], header?: string): string {
  const lines: string[] = [];

  if (header) {
    lines.push(header, "");
  }

  for (const stmt of statements) {
    const formatted = formatSQL(stmt);
    lines.push(formatted + ";", "");
  }

  return lines.join("\n");
}

/**
 * Highlights SQL keywords with ANSI color codes for terminal output.
 * Uses chalk-compatible escape sequences.
 */
export function highlightSQL(sql: string): string {
  const KEYWORDS = [
    "CREATE", "TABLE", "IF", "NOT", "EXISTS", "DROP", "ALTER",
    "ADD", "COLUMN", "RENAME", "TO", "MODIFY", "SET", "DEFAULT",
    "NULL", "PRIMARY", "KEY", "UNIQUE", "FOREIGN", "REFERENCES",
    "ON", "DELETE", "UPDATE", "CASCADE", "RESTRICT", "INDEX",
    "CONSTRAINT", "CHECK", "TRUNCATE", "INSERT", "SELECT", "FROM",
    "WHERE", "AND", "OR", "IN", "IS", "BEGIN", "COMMIT", "ROLLBACK",
    "TRANSACTION", "BIGINT", "INTEGER", "INT", "TEXT", "VARCHAR",
    "BOOLEAN", "TIMESTAMP", "DATE", "JSON", "JSONB", "UUID", "SERIAL",
  ];

  // Wrap keywords in bold cyan
  return sql.replace(
    new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "gi"),
    (match) => `\x1b[36;1m${match.toUpperCase()}\x1b[0m`
  );
}

// ============================================================
//  Internal Helpers
// ============================================================

/**
 * Splits a string by a separator, but only at the top level
 * (not inside parentheses). Used for splitting CREATE TABLE column lists.
 */
function splitTopLevel(str: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of str) {
    if (char === "(") {
      depth++;
      current += char;
    } else if (char === ")") {
      depth--;
      current += char;
    } else if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}
