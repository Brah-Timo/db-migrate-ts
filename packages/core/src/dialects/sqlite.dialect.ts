/**
 * @file sqlite.dialect.ts
 * @description SQLite database adapter using the `better-sqlite3` driver.
 *
 * Requires the optional `better-sqlite3` package:
 *   npm install better-sqlite3 @types/better-sqlite3
 *
 * Note: better-sqlite3 is SYNCHRONOUS (unusual for Node.js).
 * Our async wrapper adapts it to the standard async DatabaseAdapter interface.
 *
 * @example
 * import Database from "better-sqlite3";
 * import { SQLiteAdapter } from "db-migrate-ts/dialects/sqlite";
 *
 * const db = new Database("./app.db");
 * const adapter = new SQLiteAdapter(db);
 * const runner = new MigrationRunner(adapter, { dialect: "sqlite" });
 *
 * // For in-memory testing:
 * const db = new Database(":memory:");
 * const adapter = new SQLiteAdapter(db);
 */

import { BaseDialectAdapter } from "./base.dialect.js";

// Type-only import — better-sqlite3 is an optional peer dependency
type BetterSQLite3Database = import("better-sqlite3").Database;

/**
 * SQLite adapter wrapping `better-sqlite3`.
 *
 * Features:
 * - Synchronous driver wrapped in async interface
 * - Full transaction support (BEGIN / COMMIT / ROLLBACK)
 * - In-memory database support for testing (":memory:")
 * - WAL mode support for better concurrent reads
 * - Automatic busy timeout for locked databases
 */
export class SQLiteAdapter extends BaseDialectAdapter {
  readonly dialect = "sqlite" as const;

  /** Whether we're currently inside a transaction */
  private inTransaction = false;

  constructor(private readonly db: BetterSQLite3Database) {
    super();
  }

  // ----------------------------------------------------------
  //  Core Interface
  // ----------------------------------------------------------

  async execute(sql: string, params?: unknown[]): Promise<void> {
    try {
      this.db.prepare(sql).run(...(params ?? []));
    } catch (error) {
      throw this.wrapError(`execute("${sql.slice(0, 60)}")`, error);
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    try {
      const rows = this.db.prepare(sql).all(...(params ?? []));
      return rows as T[];
    } catch (error) {
      throw this.wrapError(`query("${sql.slice(0, 60)}")`, error);
    }
  }

  /**
   * better-sqlite3 transactions are synchronous.
   * We wrap them in a Promise to conform to the async interface.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      // SQLite doesn't support nested transactions — just run fn() directly
      // (the outer transaction will handle commit/rollback)
      return fn();
    }

    this.inTransaction = true;
    this.db.prepare("BEGIN").run();

    try {
      const result = await fn();
      this.db.prepare("COMMIT").run();
      return result;
    } catch (error) {
      try {
        this.db.prepare("ROLLBACK").run();
      } catch {
        // ROLLBACK failure is non-critical here
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // ----------------------------------------------------------
  //  SQLite-specific features
  // ----------------------------------------------------------

  /**
   * Enables WAL (Write-Ahead Logging) mode for better performance.
   * Recommended for most applications.
   */
  enableWAL(): void {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
  }

  /**
   * Sets the busy timeout for locked database files.
   * Prevents "database is locked" errors in multi-process scenarios.
   *
   * @param ms - Timeout in milliseconds (default: 5000ms)
   */
  setBusyTimeout(ms = 5000): void {
    this.db.pragma(`busy_timeout = ${ms}`);
  }

  /**
   * Enables foreign key enforcement (disabled by default in SQLite!).
   * Always call this when using foreign key constraints.
   */
  enableForeignKeys(): void {
    this.db.pragma("foreign_keys = ON");
  }

  /**
   * Returns the SQLite version string.
   */
  override async getVersion(): Promise<string> {
    const rows = await this.query<{ "sqlite_version()": string }>(
      "SELECT sqlite_version()"
    );
    return rows[0]?.["sqlite_version()"] ?? "unknown";
  }

  /**
   * Returns the list of tables in the database.
   */
  async listTables(): Promise<string[]> {
    const rows = await this.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    return rows.map((r) => r.name);
  }

  /**
   * Returns the PRAGMA integrity_check result.
   * Use for database health checks.
   */
  async integrityCheck(): Promise<boolean> {
    const rows = await this.query<{ integrity_check: string }>(
      "PRAGMA integrity_check"
    );
    return rows[0]?.integrity_check === "ok";
  }

  /**
   * Returns the raw better-sqlite3 Database instance.
   * Use for operations not covered by the standard interface.
   */
  getRaw(): BetterSQLite3Database {
    return this.db;
  }
}

// ============================================================
//  Factory Function
// ============================================================

/**
 * Creates a SQLiteAdapter from a file path or ":memory:".
 * Dynamically imports the `better-sqlite3` package.
 *
 * @example
 * const adapter = await createSQLiteAdapter("./myapp.db");
 * const testAdapter = await createSQLiteAdapter(":memory:");
 */
export async function createSQLiteAdapter(
  filename: string,
  options?: { wal?: boolean; foreignKeys?: boolean; busyTimeout?: number }
): Promise<SQLiteAdapter> {
  let Database: typeof import("better-sqlite3");
  try {
    Database = (await import("better-sqlite3")).default as typeof import("better-sqlite3");
  } catch {
    throw new Error(
      '[db-migrate-ts] SQLite adapter requires the "better-sqlite3" package.\n' +
        "Install it with: npm install better-sqlite3 @types/better-sqlite3"
    );
  }

  const db = new Database(filename);
  const adapter = new SQLiteAdapter(db);

  if (options?.wal) adapter.enableWAL();
  if (options?.foreignKeys !== false) adapter.enableForeignKeys();
  if (options?.busyTimeout) adapter.setBusyTimeout(options.busyTimeout);

  return adapter;
}
