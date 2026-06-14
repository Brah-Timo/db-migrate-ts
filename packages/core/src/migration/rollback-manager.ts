/**
 * @file rollback-manager.ts
 * @description Advanced rollback strategies for the migration system.
 *
 * While MigrationRunner.down() handles basic step-count rollbacks,
 * RollbackManager provides more advanced scenarios:
 *   - Roll back to a specific migration name
 *   - Roll back to a specific timestamp
 *   - Roll back all migrations (full reset)
 *   - Preview what would be rolled back without executing
 */

import type { Migration } from "../types/migration.types.js";
import type { DatabaseAdapter } from "../types/dialect.types.js";
import { MigrationTracker } from "./migration-tracker.js";
import { MigrationRunner } from "./migration-runner.js";
import type { Dialect } from "../types/migration.types.js";

// ============================================================
//  Rollback Manager
// ============================================================

/**
 * Provides advanced rollback strategies beyond simple step counts.
 *
 * @example
 * const manager = new RollbackManager(adapter, migrations, "postgres");
 *
 * // Roll back to a specific named migration
 * await manager.rollbackTo("20241215120000_create_users_table");
 *
 * // Roll back everything
 * await manager.rollbackAll();
 *
 * // Preview without executing
 * const plan = await manager.preview("20241215120000_create_users_table");
 * console.log("Would roll back:", plan.map(m => m.name));
 */
export class RollbackManager {
  private readonly tracker: MigrationTracker;
  private readonly runner: MigrationRunner;

  constructor(
    private readonly adapter: DatabaseAdapter,
    private readonly allMigrations: Migration[],
    private readonly dialect: Dialect,
    private readonly migrationsTable?: string
  ) {
    this.tracker = new MigrationTracker(adapter, dialect, migrationsTable);
    this.runner = new MigrationRunner(adapter, { dialect, ...(migrationsTable !== undefined && { migrationsTable }) });
  }

  // ----------------------------------------------------------
  //  Roll back to specific migration
  // ----------------------------------------------------------

  /**
   * Rolls back all migrations executed AFTER the given target migration name.
   * The target migration itself is NOT rolled back.
   *
   * @param targetName - Roll back everything after this migration
   *
   * @example
   * // Timeline: A → B → C → D (all executed)
   * await manager.rollbackTo("B");
   * // Result: A → B (C and D rolled back)
   */
  async rollbackTo(targetName: string): Promise<string[]> {
    const executed = await this.tracker.getExecuted();
    const sortedDesc = [...executed].sort((a, b) => b.timestamp - a.timestamp);

    // Find target position
    const targetIdx = sortedDesc.findIndex((r) => r.name === targetName);
    if (targetIdx === -1) {
      throw new Error(
        `[db-migrate-ts] rollbackTo: Migration "${targetName}" has not been executed. ` +
          `It cannot be used as a rollback target.`
      );
    }

    // Everything BEFORE targetIdx (newer migrations) needs to be rolled back
    const toRollback = sortedDesc.slice(0, targetIdx);

    if (toRollback.length === 0) {
      return [];
    }

    const result = await this.runner.down(this.allMigrations, toRollback.length);
    return result.rolledBack;
  }

  // ----------------------------------------------------------
  //  Roll back to specific timestamp
  // ----------------------------------------------------------

  /**
   * Rolls back all migrations with a timestamp > the given value.
   *
   * @param timestamp - Numeric timestamp (YYYYMMDDHHMMSS format)
   *
   * @example
   * await manager.rollbackToTimestamp(20241215120000);
   * // Rolls back all migrations applied after December 15, 2024 at 12:00:00
   */
  async rollbackToTimestamp(timestamp: number): Promise<string[]> {
    const executed = await this.tracker.getExecuted();
    const toRollback = executed
      .filter((r) => r.timestamp > timestamp)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (toRollback.length === 0) {
      return [];
    }

    const result = await this.runner.down(this.allMigrations, toRollback.length);
    return result.rolledBack;
  }

  // ----------------------------------------------------------
  //  Roll back everything
  // ----------------------------------------------------------

  /**
   * Rolls back ALL executed migrations (complete database reset).
   *
   * ⚠️ WARNING: This is a destructive operation that drops all your tables!
   * Use only in development/testing environments.
   */
  async rollbackAll(): Promise<string[]> {
    const executed = await this.tracker.getExecuted();

    if (executed.length === 0) {
      return [];
    }

    const result = await this.runner.down(this.allMigrations, executed.length);
    return result.rolledBack;
  }

  // ----------------------------------------------------------
  //  Preview — what would be rolled back
  // ----------------------------------------------------------

  /**
   * Returns a preview of migrations that would be rolled back
   * without actually executing anything.
   *
   * @param targetName - Target migration name (same as rollbackTo)
   */
  async preview(targetName: string): Promise<Migration[]> {
    const executed = await this.tracker.getExecuted();
    const sortedDesc = [...executed].sort((a, b) => b.timestamp - a.timestamp);

    const targetIdx = sortedDesc.findIndex((r) => r.name === targetName);
    if (targetIdx === -1) return [];

    const toRollbackNames = new Set(sortedDesc.slice(0, targetIdx).map((r) => r.name));

    return this.allMigrations.filter((m) => toRollbackNames.has(m.name));
  }

  // ----------------------------------------------------------
  //  Status Query
  // ----------------------------------------------------------

  /**
   * Returns the most recently executed migration.
   */
  async getLastExecuted(): Promise<Migration | null> {
    const executed = await this.tracker.getExecuted();
    if (executed.length === 0) return null;

    const last = [...executed].sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!last) return null;
    return this.allMigrations.find((m) => m.name === last.name) ?? null;
  }

  /**
   * Returns the number of pending migrations (not yet executed).
   */
  async getPendingCount(): Promise<number> {
    const executedNames = await this.tracker.getExecutedNames();
    return this.allMigrations.filter((m) => !executedNames.has(m.name)).length;
  }
}
