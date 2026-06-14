/**
 * @file base.dialect.ts
 * @description Base class with shared functionality for all dialect adapters.
 *
 * Provides common utilities and a standardized error-handling pattern
 * that all concrete dialect adapters inherit.
 */

import type { DatabaseAdapter } from "../types/dialect.types.js";
import type { Dialect } from "../types/migration.types.js";

/**
 * Abstract base class for all database adapters.
 * Provides shared logic and error handling.
 */
export abstract class BaseDialectAdapter implements DatabaseAdapter {
  abstract readonly dialect: Dialect;

  abstract execute(sql: string, params?: unknown[]): Promise<void>;
  abstract query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  abstract transaction<T>(fn: () => Promise<T>): Promise<T>;
  abstract close(): Promise<void>;

  /**
   * Default ping implementation — runs a trivial query.
   * Override if the database has a dedicated health check command.
   */
  async ping(): Promise<boolean> {
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
  async getVersion(): Promise<string> {
    try {
      const rows = await this.query<{ version: string }>("SELECT version()");
      return rows[0]?.version ?? "unknown";
    } catch {
      return "unknown";
    }
  }

  /**
   * Wraps a driver error with more context.
   */
  protected wrapError(operation: string, original: unknown): Error {
    const msg =
      original instanceof Error ? original.message : String(original);
    return new Error(
      `[db-migrate-ts] ${this.dialect} adapter error during ${operation}: ${msg}`
    );
  }
}
