/**
 * @file postgres.dialect.ts
 * @description PostgreSQL database adapter using the `pg` driver.
 *
 * Requires the optional `pg` package:
 *   npm install pg @types/pg
 *
 * @example
 * import { Pool } from "pg";
 * import { PostgresAdapter } from "db-migrate-ts/dialects/postgres";
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const adapter = new PostgresAdapter(pool);
 * const runner = new MigrationRunner(adapter, { dialect: "postgres" });
 */

import { BaseDialectAdapter } from "./base.dialect.js";

// Type-only imports — pg is an optional peer dependency
type PgPool = import("pg").Pool;
type PgClient = import("pg").PoolClient;

/**
 * PostgreSQL adapter wrapping the `pg` connection Pool.
 *
 * Features:
 * - Full transaction support (BEGIN / COMMIT / ROLLBACK)
 * - Connection pooling via pg.Pool
 * - Nested transaction support via savepoints
 * - Advisory lock support for distributed deployments
 */
export class PostgresAdapter extends BaseDialectAdapter {
  readonly dialect = "postgres" as const;

  /** Active client during a transaction (null outside transactions) */
  private transactionClient: PgClient | null = null;

  /** Tracks savepoint depth for nested transactions */
  private savepointDepth = 0;

  constructor(private readonly pool: PgPool) {
    super();
  }

  // ----------------------------------------------------------
  //  Core Interface
  // ----------------------------------------------------------

  async execute(sql: string, params?: unknown[]): Promise<void> {
    const client = this.transactionClient ?? this.pool;
    try {
      await client.query(sql, params ?? []);
    } catch (error) {
      throw this.wrapError(`execute("${sql.slice(0, 60)}")`, error);
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const client = this.transactionClient ?? this.pool;
    try {
      const result = await client.query(sql, params ?? []);
      return result.rows as T[];
    } catch (error) {
      throw this.wrapError(`query("${sql.slice(0, 60)}")`, error);
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Top-level transaction
    if (!this.transactionClient) {
      return this.runTopLevelTransaction(fn);
    }
    // Nested transaction → use savepoint
    return this.runNestedTransaction(fn);
  }

  async close(): Promise<void> {
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
  async tryAdvisoryLock(lockId = 78549378): Promise<boolean> {
    const rows = await this.query<{ result: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS result",
      [lockId]
    );
    return rows[0]?.result === true;
  }

  /**
   * Releases a previously acquired advisory lock.
   */
  async releaseAdvisoryLock(lockId = 78549378): Promise<void> {
    await this.execute("SELECT pg_advisory_unlock($1)", [lockId]);
  }

  /**
   * Returns the PostgreSQL server version as a semver string.
   *
   * @example
   * await adapter.getVersion(); // → "16.1"
   */
  override async getVersion(): Promise<string> {
    const rows = await this.query<{ version: string }>("SHOW server_version");
    return rows[0]?.version ?? "unknown";
  }

  /**
   * Returns the list of tables in the public schema.
   */
  async listTables(): Promise<string[]> {
    const rows = await this.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    return rows.map((r) => r.table_name);
  }

  // ----------------------------------------------------------
  //  Internal transaction helpers
  // ----------------------------------------------------------

  private async runTopLevelTransaction<T>(fn: () => Promise<T>): Promise<T> {
    this.transactionClient = await this.pool.connect();
    try {
      await this.transactionClient.query("BEGIN");
      const result = await fn();
      await this.transactionClient.query("COMMIT");
      return result;
    } catch (error) {
      await this.transactionClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      this.transactionClient.release();
      this.transactionClient = null;
    }
  }

  private async runNestedTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const savepointName = `sp_${++this.savepointDepth}`;
    try {
      await this.execute(`SAVEPOINT ${savepointName}`);
      const result = await fn();
      await this.execute(`RELEASE SAVEPOINT ${savepointName}`);
      return result;
    } catch (error) {
      await this.execute(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => undefined);
      throw error;
    } finally {
      this.savepointDepth--;
    }
  }
}

// ============================================================
//  Factory Function
// ============================================================

/**
 * Creates a PostgresAdapter from a connection string or Pool config.
 * Dynamically imports the `pg` package.
 *
 * @example
 * const adapter = await createPostgresAdapter(process.env.DATABASE_URL);
 */
export async function createPostgresAdapter(
  connectionString: string
): Promise<PostgresAdapter> {
  let Pool: typeof import("pg").Pool;
  try {
    const pg = await import("pg");
    Pool = pg.Pool ?? (pg as unknown as { default: { Pool: typeof import("pg").Pool } }).default.Pool;
  } catch {
    throw new Error(
      '[db-migrate-ts] PostgreSQL adapter requires the "pg" package.\n' +
        "Install it with: npm install pg @types/pg"
    );
  }

  const pool = new Pool({ connectionString });
  return new PostgresAdapter(pool);
}
