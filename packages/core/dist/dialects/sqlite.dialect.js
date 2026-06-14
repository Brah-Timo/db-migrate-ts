'use strict';

/**
 * db-migrate-ts v1.0.0
 * Type-safe database migrations powered by Zod and TypeScript
 * License: MIT — https://github.com/db-migrate-ts/db-migrate-ts
 */

// src/dialects/base.dialect.ts
var BaseDialectAdapter = class {
  /**
   * Default ping implementation — runs a trivial query.
   * Override if the database has a dedicated health check command.
   */
  async ping() {
    try {
      await this.execute("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Default version implementation.
   * Override for dialect-specific version queries.
   */
  async getVersion() {
    try {
      const rows = await this.query("SELECT version()");
      return rows[0]?.version ?? "unknown";
    } catch {
      return "unknown";
    }
  }
  /**
   * Wraps a driver error with more context.
   */
  wrapError(operation, original) {
    const msg = original instanceof Error ? original.message : String(original);
    return new Error(
      `[db-migrate-ts] ${this.dialect} adapter error during ${operation}: ${msg}`
    );
  }
};

// src/dialects/sqlite.dialect.ts
var SQLiteAdapter = class extends BaseDialectAdapter {
  constructor(db) {
    super();
    this.db = db;
  }
  db;
  dialect = "sqlite";
  /** Whether we're currently inside a transaction */
  inTransaction = false;
  // ----------------------------------------------------------
  //  Core Interface
  // ----------------------------------------------------------
  async execute(sql, params) {
    try {
      this.db.prepare(sql).run(...params ?? []);
    } catch (error) {
      throw this.wrapError(`execute("${sql.slice(0, 60)}")`, error);
    }
  }
  async query(sql, params) {
    try {
      const rows = this.db.prepare(sql).all(...params ?? []);
      return rows;
    } catch (error) {
      throw this.wrapError(`query("${sql.slice(0, 60)}")`, error);
    }
  }
  /**
   * better-sqlite3 transactions are synchronous.
   * We wrap them in a Promise to conform to the async interface.
   */
  async transaction(fn) {
    if (this.inTransaction) {
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
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }
  async close() {
    this.db.close();
  }
  // ----------------------------------------------------------
  //  SQLite-specific features
  // ----------------------------------------------------------
  /**
   * Enables WAL (Write-Ahead Logging) mode for better performance.
   * Recommended for most applications.
   */
  enableWAL() {
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
  }
  /**
   * Sets the busy timeout for locked database files.
   * Prevents "database is locked" errors in multi-process scenarios.
   *
   * @param ms - Timeout in milliseconds (default: 5000ms)
   */
  setBusyTimeout(ms = 5e3) {
    this.db.pragma(`busy_timeout = ${ms}`);
  }
  /**
   * Enables foreign key enforcement (disabled by default in SQLite!).
   * Always call this when using foreign key constraints.
   */
  enableForeignKeys() {
    this.db.pragma("foreign_keys = ON");
  }
  /**
   * Returns the SQLite version string.
   */
  async getVersion() {
    const rows = await this.query(
      "SELECT sqlite_version()"
    );
    return rows[0]?.["sqlite_version()"] ?? "unknown";
  }
  /**
   * Returns the list of tables in the database.
   */
  async listTables() {
    const rows = await this.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    return rows.map((r) => r.name);
  }
  /**
   * Returns the PRAGMA integrity_check result.
   * Use for database health checks.
   */
  async integrityCheck() {
    const rows = await this.query(
      "PRAGMA integrity_check"
    );
    return rows[0]?.integrity_check === "ok";
  }
  /**
   * Returns the raw better-sqlite3 Database instance.
   * Use for operations not covered by the standard interface.
   */
  getRaw() {
    return this.db;
  }
};
async function createSQLiteAdapter(filename, options) {
  let Database;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch {
    throw new Error(
      '[db-migrate-ts] SQLite adapter requires the "better-sqlite3" package.\nInstall it with: npm install better-sqlite3 @types/better-sqlite3'
    );
  }
  const db = new Database(filename);
  const adapter = new SQLiteAdapter(db);
  if (options?.wal) adapter.enableWAL();
  if (options?.foreignKeys !== false) adapter.enableForeignKeys();
  if (options?.busyTimeout) adapter.setBusyTimeout(options.busyTimeout);
  return adapter;
}

exports.SQLiteAdapter = SQLiteAdapter;
exports.createSQLiteAdapter = createSQLiteAdapter;
//# sourceMappingURL=sqlite.dialect.js.map
//# sourceMappingURL=sqlite.dialect.js.map