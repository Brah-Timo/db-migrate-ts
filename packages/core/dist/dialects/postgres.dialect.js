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

// src/dialects/postgres.dialect.ts
var PostgresAdapter = class extends BaseDialectAdapter {
  constructor(pool) {
    super();
    this.pool = pool;
  }
  pool;
  dialect = "postgres";
  /** Active client during a transaction (null outside transactions) */
  transactionClient = null;
  /** Tracks savepoint depth for nested transactions */
  savepointDepth = 0;
  // ----------------------------------------------------------
  //  Core Interface
  // ----------------------------------------------------------
  async execute(sql, params) {
    const client = this.transactionClient ?? this.pool;
    try {
      await client.query(sql, params ?? []);
    } catch (error) {
      throw this.wrapError(`execute("${sql.slice(0, 60)}")`, error);
    }
  }
  async query(sql, params) {
    const client = this.transactionClient ?? this.pool;
    try {
      const result = await client.query(sql, params ?? []);
      return result.rows;
    } catch (error) {
      throw this.wrapError(`query("${sql.slice(0, 60)}")`, error);
    }
  }
  async transaction(fn) {
    if (!this.transactionClient) {
      return this.runTopLevelTransaction(fn);
    }
    return this.runNestedTransaction(fn);
  }
  async close() {
    await this.pool.end();
  }
  // ----------------------------------------------------------
  //  PostgreSQL-specific features
  // ----------------------------------------------------------
  /**
   * Acquires an advisory lock to prevent concurrent migration runs.
   * Uses PostgreSQL's advisory locking mechanism.
   *
   * @param lockId - A unique numeric lock identifier (e.g., hash of "db-migrate-ts")
   * @returns true if the lock was acquired, false if it's already held
   */
  async tryAdvisoryLock(lockId = 78549378) {
    const rows = await this.query(
      "SELECT pg_try_advisory_lock($1) AS result",
      [lockId]
    );
    return rows[0]?.result === true;
  }
  /**
   * Releases a previously acquired advisory lock.
   */
  async releaseAdvisoryLock(lockId = 78549378) {
    await this.execute("SELECT pg_advisory_unlock($1)", [lockId]);
  }
  /**
   * Returns the PostgreSQL server version as a semver string.
   *
   * @example
   * await adapter.getVersion(); // → "16.1"
   */
  async getVersion() {
    const rows = await this.query("SHOW server_version");
    return rows[0]?.version ?? "unknown";
  }
  /**
   * Returns the list of tables in the public schema.
   */
  async listTables() {
    const rows = await this.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    return rows.map((r) => r.table_name);
  }
  // ----------------------------------------------------------
  //  Internal transaction helpers
  // ----------------------------------------------------------
  async runTopLevelTransaction(fn) {
    this.transactionClient = await this.pool.connect();
    try {
      await this.transactionClient.query("BEGIN");
      const result = await fn();
      await this.transactionClient.query("COMMIT");
      return result;
    } catch (error) {
      await this.transactionClient.query("ROLLBACK").catch(() => void 0);
      throw error;
    } finally {
      this.transactionClient.release();
      this.transactionClient = null;
    }
  }
  async runNestedTransaction(fn) {
    const savepointName = `sp_${++this.savepointDepth}`;
    try {
      await this.execute(`SAVEPOINT ${savepointName}`);
      const result = await fn();
      await this.execute(`RELEASE SAVEPOINT ${savepointName}`);
      return result;
    } catch (error) {
      await this.execute(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => void 0);
      throw error;
    } finally {
      this.savepointDepth--;
    }
  }
};
async function createPostgresAdapter(connectionString) {
  let Pool;
  try {
    const pg = await import('pg');
    Pool = pg.Pool ?? pg.default.Pool;
  } catch {
    throw new Error(
      '[db-migrate-ts] PostgreSQL adapter requires the "pg" package.\nInstall it with: npm install pg @types/pg'
    );
  }
  const pool = new Pool({ connectionString });
  return new PostgresAdapter(pool);
}

exports.PostgresAdapter = PostgresAdapter;
exports.createPostgresAdapter = createPostgresAdapter;
//# sourceMappingURL=postgres.dialect.js.map
//# sourceMappingURL=postgres.dialect.js.map