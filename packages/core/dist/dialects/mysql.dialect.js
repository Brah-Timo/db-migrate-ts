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

// src/dialects/mysql.dialect.ts
var MySQLAdapter = class extends BaseDialectAdapter {
  constructor(pool) {
    super();
    this.pool = pool;
  }
  pool;
  dialect = "mysql";
  /** Active connection during a transaction */
  transactionConnection = null;
  // ----------------------------------------------------------
  //  Core Interface
  // ----------------------------------------------------------
  async execute(sql, params) {
    const client = this.transactionConnection ?? this.pool;
    try {
      await client.execute(sql, params ?? []);
    } catch (error) {
      throw this.wrapError(`execute("${sql.slice(0, 60)}")`, error);
    }
  }
  async query(sql, params) {
    const client = this.transactionConnection ?? this.pool;
    try {
      const [rows] = await client.execute(
        sql,
        params ?? []
      );
      return rows;
    } catch (error) {
      throw this.wrapError(`query("${sql.slice(0, 60)}")`, error);
    }
  }
  async transaction(fn) {
    this.transactionConnection = await this.pool.getConnection();
    try {
      await this.transactionConnection.beginTransaction();
      const result = await fn();
      await this.transactionConnection.commit();
      return result;
    } catch (error) {
      await this.transactionConnection.rollback().catch(() => void 0);
      throw error;
    } finally {
      this.transactionConnection.release();
      this.transactionConnection = null;
    }
  }
  async close() {
    await this.pool.end();
  }
  // ----------------------------------------------------------
  //  MySQL-specific features
  // ----------------------------------------------------------
  /**
   * Acquires a named MySQL lock to prevent concurrent migration runs.
   *
   * @param lockName - Lock name (string, up to 64 chars)
   * @param timeout  - Wait timeout in seconds (0 = fail immediately)
   */
  async tryNamedLock(lockName = "db-migrate-ts", timeout = 0) {
    const rows = await this.query(
      "SELECT GET_LOCK(?, ?) AS result",
      [lockName, timeout]
    );
    return rows[0]?.result === 1;
  }
  /**
   * Releases a named MySQL lock.
   */
  async releaseNamedLock(lockName = "db-migrate-ts") {
    await this.execute("SELECT RELEASE_LOCK(?)", [lockName]);
  }
  /**
   * Returns the MySQL/MariaDB server version.
   */
  async getVersion() {
    const rows = await this.query("SELECT VERSION()");
    return rows[0]?.["VERSION()"] ?? "unknown";
  }
  /**
   * Returns the list of tables in the current database.
   */
  async listTables() {
    const rows = await this.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`
    );
    return rows.map((r) => r.TABLE_NAME);
  }
};
async function createMySQLAdapter(uri) {
  let createPool;
  try {
    const mysql2 = await import('mysql2/promise');
    createPool = mysql2.createPool;
  } catch {
    throw new Error(
      '[db-migrate-ts] MySQL adapter requires the "mysql2" package.\nInstall it with: npm install mysql2'
    );
  }
  const pool = createPool({ uri });
  return new MySQLAdapter(pool);
}

exports.MySQLAdapter = MySQLAdapter;
exports.createMySQLAdapter = createMySQLAdapter;
//# sourceMappingURL=mysql.dialect.js.map
//# sourceMappingURL=mysql.dialect.js.map