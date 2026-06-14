/**
 * @file migration-runner.ts
 * @description The Migration Runner — orchestrates the full migration lifecycle.
 *
 * MigrationRunner coordinates:
 *   1. MigrationTracker    — database history table management
 *   2. MigrationBuilderImpl — DDL operation collection
 *   3. SqlBuilder           — SQL compilation
 *   4. DatabaseAdapter      — actual query execution
 *
 * Execution flow for `up`:
 *   discover pending → sort by timestamp → for each: build → compile → execute in transaction → record
 *
 * Execution flow for `down`:
 *   get last N executed → for each: build → compile → execute in transaction → remove record
 */

import type { Migration, MigrationRecord, MigrationRunnerOptions, MigrationStatusEntry } from "../types/migration.types.js";
import type { DatabaseAdapter } from "../types/dialect.types.js";
import { MigrationBuilderImpl } from "./migration-builder.js";
import { MigrationTracker } from "./migration-tracker.js";
import { SqlBuilder } from "../sql/sql-builder.js";
import { computeMigrationChecksum } from "../utils/hash.js";
import { MigrationExecutionError } from "../utils/errors.js";
import { Logger, createLogger } from "../utils/logger.js";
import chalk from "chalk";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

// ============================================================
//  Migration Runner
// ============================================================

/**
 * Orchestrates migration execution, rollback, and status reporting.
 *
 * @example
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const adapter = new PostgresAdapter(pool);
 * const runner = new MigrationRunner(adapter, {
 *   dialect: "postgres",
 *   validateChecksums: true,
 * });
 *
 * await runner.up(migrations);    // Apply all pending
 * await runner.down(migrations, 1); // Rollback last one
 * const status = await runner.status(migrations); // Get status report
 */
export class MigrationRunner {
  private readonly tracker: MigrationTracker;
  private readonly sqlBuilder: SqlBuilder;
  private readonly logger: Logger;
  private readonly options: Required<Omit<MigrationRunnerOptions, "logger">>;

  constructor(
    private readonly adapter: DatabaseAdapter,
    optionsOrDialect:
      | MigrationRunnerOptions
      | MigrationRunnerOptions["dialect"]
  ) {
    // Support both shorthand (dialect string) and full options object
    const opts: MigrationRunnerOptions =
      typeof optionsOrDialect === "string"
        ? { dialect: optionsOrDialect }
        : optionsOrDialect;

    this.options = {
      dialect: opts.dialect,
      migrationsTable: opts.migrationsTable ?? "_db_migrate_ts_history",
      validateChecksums: opts.validateChecksums ?? true,
      saveSQLSnapshots: opts.saveSQLSnapshots ?? false,
      snapshotsDir: opts.snapshotsDir ?? "./migrations/snapshots",
      dryRun: opts.dryRun ?? false,
    };

    this.tracker = new MigrationTracker(
      adapter,
      opts.dialect,
      this.options.migrationsTable
    );

    this.sqlBuilder = new SqlBuilder(opts.dialect);

    this.logger = opts.logger
      ? createLogger()
      : createLogger({ prefix: "db-migrate-ts" });
  }

  // ----------------------------------------------------------
  //  UP — Apply pending migrations
  // ----------------------------------------------------------

  /**
   * Runs all pending migrations in ascending timestamp order.
   * Each migration is wrapped in a database transaction.
   *
   * @param migrations - Complete list of all migration definitions
   * @param limit      - Optional: run at most N pending migrations
   */
  async up(migrations: Migration[], limit?: number): Promise<MigrationRunnerResult> {
    // 1. Ensure the history table exists
    await this.tracker.ensureTable();

    // 2. Get already-executed migration names
    const executedNames = await this.tracker.getExecutedNames();

    // 3. Compute checksums for all migrations
    const checksumMap = new Map(
      migrations.map((m) => [m.name, computeMigrationChecksum(m)])
    );

    // 4. Validate checksums of already-executed migrations (tamper detection)
    if (this.options.validateChecksums) {
      await this.tracker.validateChecksums(checksumMap);
    }

    // 5. Filter and sort pending migrations
    const pending = migrations
      .filter((m) => !executedNames.has(m.name))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, limit);

    if (pending.length === 0) {
      this.logger.success("Database is already up to date. No pending migrations.");
      return { applied: [], rolledBack: [], dryRun: this.options.dryRun };
    }

    this.logger.info(
      `Found ${pending.length} pending migration${pending.length === 1 ? "" : "s"}. Running...`
    );
    this.logger.blank();

    const applied: string[] = [];

    // 6. Run each pending migration
    for (const migration of pending) {
      await this.runMigrationUp(migration, checksumMap.get(migration.name)!);
      applied.push(migration.name);
    }

    this.logger.blank();
    this.logger.success(
      `✅ ${applied.length} migration${applied.length === 1 ? "" : "s"} applied successfully.`
    );

    return { applied, rolledBack: [], dryRun: this.options.dryRun };
  }

  // ----------------------------------------------------------
  //  DOWN — Rollback migrations
  // ----------------------------------------------------------

  /**
   * Rolls back the last N executed migrations (default: 1).
   *
   * @param migrations - Complete list of all migration definitions
   * @param steps      - Number of migrations to roll back (default: 1)
   */
  async down(migrations: Migration[], steps = 1): Promise<MigrationRunnerResult> {
    await this.tracker.ensureTable();

    const executed = await this.tracker.getExecuted();
    const toRollback = executed
      .sort((a, b) => b.timestamp - a.timestamp) // Newest first
      .slice(0, steps);

    if (toRollback.length === 0) {
      this.logger.warn("No migrations to rollback.");
      return { applied: [], rolledBack: [], dryRun: this.options.dryRun };
    }

    this.logger.info(
      `Rolling back ${toRollback.length} migration${toRollback.length === 1 ? "" : "s"}...`
    );
    this.logger.blank();

    const rolledBack: string[] = [];

    for (const record of toRollback) {
      // Find the migration definition
      const migration = migrations.find((m) => m.name === record.name);
      if (!migration) {
        throw new Error(
          `[db-migrate-ts] Cannot rollback "${record.name}" — ` +
            `migration file not found. ` +
            `If you deleted the file intentionally, remove the record manually:\n` +
            `  DELETE FROM ${this.options.migrationsTable} WHERE name = '${record.name}'`
        );
      }

      await this.runMigrationDown(migration, record);
      rolledBack.push(record.name);
    }

    this.logger.blank();
    this.logger.success(
      `✅ ${rolledBack.length} migration${rolledBack.length === 1 ? "" : "s"} rolled back.`
    );

    return { applied: [], rolledBack, dryRun: this.options.dryRun };
  }

  // ----------------------------------------------------------
  //  STATUS — Report migration state
  // ----------------------------------------------------------

  /**
   * Returns the status of all migrations (pending/executed/unknown).
   *
   * @param migrations - Complete list of all migration definitions
   */
  async status(migrations: Migration[]): Promise<MigrationStatusEntry[]> {
    await this.tracker.ensureTable();

    const executed = await this.tracker.getExecuted();
    const executedMap = new Map(executed.map((r) => [r.name, r]));

    // Migrations defined in files
    const fileEntries: MigrationStatusEntry[] = migrations
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((m) => {
        const record = executedMap.get(m.name);
        if (record) {
          // Verify checksum
          const currentChecksum = computeMigrationChecksum(m);
          const checksumValid = currentChecksum === record.checksum;
          return {
            name: m.name,
            timestamp: m.timestamp,
            status: "executed" as const,
            executedAt: record.executedAt,
            durationMs: record.durationMs,
            checksumValid,
          };
        }
        return {
          name: m.name,
          timestamp: m.timestamp,
          status: "pending" as const,
        };
      });

    // Migrations in DB but not in files (orphaned)
    const fileNames = new Set(migrations.map((m) => m.name));
    const orphanEntries: MigrationStatusEntry[] = executed
      .filter((r) => !fileNames.has(r.name))
      .map((r) => ({
        name: r.name,
        timestamp: r.timestamp,
        status: "skipped" as const,
        executedAt: r.executedAt,
      }));

    return [...fileEntries, ...orphanEntries];
  }

  // ----------------------------------------------------------
  //  Internal Migration Execution
  // ----------------------------------------------------------

  /**
   * Runs a single migration's `up` function inside a transaction.
   */
  private async runMigrationUp(migration: Migration, checksum: string): Promise<void> {
    const name = migration.name;
    process.stdout.write(`  ${chalk.gray("→")} ${chalk.white(name)}  `);

    const builder = new MigrationBuilderImpl(this.options.dialect);
    let durationMs: number | undefined;

    try {
      // Collect operations by running the up() function
      await migration.up(builder);

      // Compile operations to SQL statements
      const statements = this.sqlBuilder.compile(builder.getOperations());

      if (this.options.dryRun) {
        // Dry run: show SQL but don't execute
        process.stdout.write(chalk.yellow("(dry run)\n"));
        console.log(chalk.gray("    SQL:"));
        statements.forEach((sql) => console.log(chalk.gray(`      ${sql}`)));
        return;
      }

      // Save SQL snapshot if configured
      if (this.options.saveSQLSnapshots && statements.length > 0) {
        await this.saveSnapshot(name, "up", statements);
      }

      // Execute all statements in a single transaction
      const startTime = Date.now();
      await this.adapter.transaction(async () => {
        for (const sql of statements) {
          await this.adapter.execute(sql);
        }
        // Record the migration within the same transaction
        await this.tracker.record(name, migration.timestamp, checksum, undefined);
      });
      durationMs = Date.now() - startTime;

      // Update duration (separate query since transaction is committed)
      // Note: duration is informational, failure here is non-critical

      process.stdout.write(chalk.green("✓") + chalk.gray(` (${durationMs}ms)\n`));
    } catch (error) {
      process.stdout.write(chalk.red("✗\n"));
      throw new MigrationExecutionError(
        name,
        "up",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Runs a single migration's `down` function inside a transaction.
   */
  private async runMigrationDown(
    migration: Migration,
    record: MigrationRecord
  ): Promise<void> {
    const name = migration.name;
    process.stdout.write(`  ${chalk.gray("←")} ${chalk.white(name)}  `);

    const builder = new MigrationBuilderImpl(this.options.dialect);

    try {
      await migration.down(builder);
      const statements = this.sqlBuilder.compile(builder.getOperations());

      if (this.options.dryRun) {
        process.stdout.write(chalk.yellow("(dry run)\n"));
        console.log(chalk.gray("    SQL:"));
        statements.forEach((sql) => console.log(chalk.gray(`      ${sql}`)));
        return;
      }

      if (this.options.saveSQLSnapshots && statements.length > 0) {
        await this.saveSnapshot(name, "down", statements);
      }

      const startTime = Date.now();
      await this.adapter.transaction(async () => {
        for (const sql of statements) {
          await this.adapter.execute(sql);
        }
        await this.tracker.remove(record.name);
      });
      const durationMs = Date.now() - startTime;

      process.stdout.write(chalk.green("✓") + chalk.gray(` (${durationMs}ms)\n`));
    } catch (error) {
      process.stdout.write(chalk.red("✗\n"));
      throw new MigrationExecutionError(
        name,
        "down",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // ----------------------------------------------------------
  //  SQL Snapshot Saving
  // ----------------------------------------------------------

  private async saveSnapshot(
    migrationName: string,
    direction: "up" | "down",
    statements: string[]
  ): Promise<void> {
    try {
      await mkdir(this.options.snapshotsDir, { recursive: true });
      const filename = `${migrationName}.${direction}.snapshot.sql`;
      const filepath = join(this.options.snapshotsDir, filename);
      const content = [
        `-- Snapshot: ${migrationName} (${direction})`,
        `-- Generated: ${new Date().toISOString()}`,
        `-- Dialect: ${this.options.dialect}`,
        "",
        ...statements.map((s) => s + ";"),
        "",
      ].join("\n");

      await writeFile(filepath, content, "utf-8");
    } catch {
      // Snapshot saving is non-critical — log and continue
      this.logger.warn(`Could not save SQL snapshot for "${migrationName}"`);
    }
  }
}

// ============================================================
//  Result Types
// ============================================================

export interface MigrationRunnerResult {
  /** Names of migrations that were applied */
  applied: string[];
  /** Names of migrations that were rolled back */
  rolledBack: string[];
  /** Whether this was a dry run (no actual DB changes) */
  dryRun: boolean;
}
