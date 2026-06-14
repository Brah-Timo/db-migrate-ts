/**
 * @file mysql.dialect.ts
 * @description MySQL/MariaDB database adapter using the `mysql2` driver.
 *
 * Requires the optional `mysql2` package:
 *   npm install mysql2
 *
 * @example
 * import { createPool } from "mysql2/promise";
 * import { MySQLAdapter } from "db-migrate-ts/dialects/mysql";
 *
 * const pool = createPool({ uri: process.env.DATABASE_URL });
 * const adapter = new MySQLAdapter(pool);
 * const runner = new MigrationRunner(adapter, { dialect: "mysql" });
 */

import { BaseDialectAdapter } from "./base.dialect.js";

// Type-only imports — mysql2 is an optional peer dependency
type MySQL2Pool = import("mysql2/promise").Pool;
type MySQL2Connection = import("mysql2/promise").PoolConnection;

/**
 * MySQL/MariaDB adapter wrapping the `mysql2` connection pool.
 *
 * Features:
 * - Full transaction support (START TRANSACTION / COMMIT / ROLLBACK)
 * - Connection pooling
 * - Parameterized queries using `?` placeholders
 * - Named lock support (GET_LOCK / RELEASE_LOCK)
 */
export class MySQLAdapter extends BaseDialectAdapter {
  readonly dialect = "mysql" as const;

  /** Active connection during a transaction */
  private transactionConnection: MySQL2Connection | null = null;

  constructor(private readonly pool: MySQL2Pool) {
    super();
  }

  // ----------------------------------------------------------
  //  Core Interface
  // ----------------------------------------------------------

  async execute(sql: string, params?: unknown[]): Promise<void> {
    const client = this.transactionConnection ?? this.pool;
    try {
      await client.execute(sql, (params ?? []) as import("mysql2/promise").ExecuteValues[]);
    } catch (error) {
      throw this.wrapError(`execute("${sql.slice(0, 60)}")`, error);
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const client = this.transactionConnection ?? this.pool;
    try {
      const [rows] = await client.execute<import("mysql2/promise").RowDataPacket[]>(
        sql,
        (params ?? []) as import("mysql2/promise").ExecuteValues[]
      );
      return rows as unknown as T[];
    } catch (error) {
      throw this.wrapError(`query("${sql.slice(0, 60)}")`, error);
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.transactionConnection = await this.pool.getConnection();
    try {
      await this.transactionConnection.beginTransaction();
      const result = await fn();
      await this.transactionConnection.commit();
      return result;
    } catch (error) {
      await this.transactionConnection.rollback().catch(() => undefined);
      throw error;
    } finally {
      this.transactionConnection.release();
      this.transactionConnection = null;
    }
  }

  async close(): Promise<void> {
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
  async tryNamedLock(lockName = "db-migrate-ts", timeout = 0): Promise<boolean> {
    const rows = await this.query<{ result: number }>(
      "SELECT GET_LOCK(?, ?) AS result",
      [lockName, timeout]
    );
    return rows[0]?.result === 1;
  }

  /**
   * Releases a named MySQL lock.
   */
  async releaseNamedLock(lockName = "db-migrate-ts"): Promise<void> {
    await this.execute("SELECT RELEASE_LOCK(?)", [lockName]);
  }

  /**
   * Returns the MySQL/MariaDB server version.
   */
  override async getVersion(): Promise<string> {
    const rows = await this.query<{ "VERSION()": string }>("SELECT VERSION()");
    return rows[0]?.["VERSION()"] ?? "unknown";
  }

  /**
   * Returns the list of tables in the current database.
   */
  async listTables(): Promise<string[]> {
    const rows = await this.query<{ TABLE_NAME: string }>(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`
    );
    return rows.map((r) => r.TABLE_NAME);
  }
}

// ============================================================
//  Factory Function
// ============================================================

/**
 * Creates a MySQLAdapter from a connection URI.
 * Dynamically imports the `mysql2` package.
 *
 * @example
 * const adapter = await createMySQLAdapter(process.env.DATABASE_URL);
 */
export async function createMySQLAdapter(uri: string): Promise<MySQLAdapter> {
  let createPool: typeof import("mysql2/promise").createPool;
  try {
    const mysql2 = await import("mysql2/promise");
    createPool = mysql2.createPool;
  } catch {
    throw new Error(
      '[db-migrate-ts] MySQL adapter requires the "mysql2" package.\n' +
        "Install it with: npm install mysql2"
    );
  }

  const pool = createPool({ uri });
  return new MySQLAdapter(pool);
}
