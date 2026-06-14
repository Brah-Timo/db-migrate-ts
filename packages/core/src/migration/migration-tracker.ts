/**
 * @file migration-tracker.ts
 * @description Manages the migrations history table in the database.
 *
 * The MigrationTracker is responsible for:
 *   1. Creating the `_db_migrate_ts_history` table on first run
 *   2. Recording successful migrations with their checksums
 *   3. Removing records when rolling back
 *   4. Querying the list of executed migrations
 *   5. Validating checksums against stored values
 */

import type { DatabaseAdapter } from "../types/dialect.types.js";
import type { MigrationRecord, Dialect } from "../types/migration.types.js";
import { ChecksumMismatchError } from "../utils/errors.js";

// ============================================================
//  Migration Tracker
// ============================================================

/** Default name for the migrations history table */
export const DEFAULT_MIGRATIONS_TABLE = "_db_migrate_ts_history";

/**
 * Manages the migrations tracking table in the database.
 *
 * @example
 * const tracker = new MigrationTracker(adapter, "postgres");
 * await tracker.ensureTable();
 *
 * const executed = await tracker.getExecuted();
 * console.log(`${executed.length} migrations already applied`);
 */
export class MigrationTracker {
  private readonly tableName: string;

  constructor(
    private readonly adapter: DatabaseAdapter,
    private readonly dialect: Dialect,
    tableName: string = DEFAULT_MIGRATIONS_TABLE
  ) {
    this.tableName = tableName;
  }

  // ----------------------------------------------------------
  //  Table Setup
  // ----------------------------------------------------------

  /**
   * Creates the migrations history table if it doesn't already exist.
   * Safe to call multiple times (uses CREATE TABLE IF NOT EXISTS).
   */
  async ensureTable(): Promise<void> {
    const sql = this.getCreateTableSQL();
    await this.adapter.execute(sql);

    // Create an index on the name column for fast lookups
    const indexSQL = this.getCreateIndexSQL();
    await this.adapter.execute(indexSQL);
  }

  private getCreateTableSQL(): string {
    switch (this.dialect) {
      case "postgres":
        return `
          CREATE TABLE IF NOT EXISTS ${this.quote(this.tableName)} (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(500) NOT NULL UNIQUE,
            timestamp   BIGINT NOT NULL,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            checksum    VARCHAR(64) NOT NULL,
            duration_ms INTEGER
          );
        `.trim();

      case "mysql":
        return `
          CREATE TABLE IF NOT EXISTS \`${this.tableName}\` (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            name        VARCHAR(500) NOT NULL UNIQUE,
            timestamp   BIGINT NOT NULL,
            executed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            checksum    VARCHAR(64) NOT NULL,
            duration_ms INT
          );
        `.trim();

      case "sqlite":
        return `
          CREATE TABLE IF NOT EXISTS "${this.tableName}" (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL UNIQUE,
            timestamp   INTEGER NOT NULL,
            executed_at TEXT NOT NULL DEFAULT (datetime('now')),
            checksum    TEXT NOT NULL,
            duration_ms INTEGER
          );
        `.trim();
    }
  }

  private getCreateIndexSQL(): string {
    const indexName = `idx_${this.tableName}_name`;
    switch (this.dialect) {
      case "postgres":
        return `CREATE INDEX IF NOT EXISTS "${indexName}" ON ${this.quote(this.tableName)} (name);`;
      case "mysql":
        // MySQL creates index automatically for UNIQUE columns
        return `-- MySQL: unique index on name already created by UNIQUE constraint`;
      case "sqlite":
        return `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${this.tableName}" (name);`;
    }
  }

  // ----------------------------------------------------------
  //  CRUD Operations
  // ----------------------------------------------------------

  /**
   * Returns all executed migrations, ordered by timestamp ascending.
   */
  async getExecuted(): Promise<MigrationRecord[]> {
    const rows = await this.adapter.query<RawMigrationRow>(
      `SELECT * FROM ${this.quote(this.tableName)} ORDER BY timestamp ASC`
    );
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Returns the set of executed migration names (for O(1) lookups).
   */
  async getExecutedNames(): Promise<Set<string>> {
    const executed = await this.getExecuted();
    return new Set(executed.map((m) => m.name));
  }

  /**
   * Records a migration as executed.
   */
  async record(
    name: string,
    timestamp: number,
    checksum: string,
    durationMs?: number
  ): Promise<void> {
    if (this.dialect === "postgres") {
      await this.adapter.execute(
        `INSERT INTO ${this.quote(this.tableName)} (name, timestamp, checksum, duration_ms)
         VALUES ($1, $2, $3, $4)`,
        [name, timestamp, checksum, durationMs ?? null]
      );
    } else if (this.dialect === "mysql") {
      await this.adapter.execute(
        `INSERT INTO \`${this.tableName}\` (name, timestamp, checksum, duration_ms)
         VALUES (?, ?, ?, ?)`,
        [name, timestamp, checksum, durationMs ?? null]
      );
    } else {
      await this.adapter.execute(
        `INSERT INTO "${this.tableName}" (name, timestamp, checksum, duration_ms)
         VALUES (?, ?, ?, ?)`,
        [name, timestamp, checksum, durationMs ?? null]
      );
    }
  }

  /**
   * Removes a migration record (used during rollback).
   */
  async remove(name: string): Promise<void> {
    if (this.dialect === "postgres") {
      await this.adapter.execute(
        `DELETE FROM ${this.quote(this.tableName)} WHERE name = $1`,
        [name]
      );
    } else {
      await this.adapter.execute(
        `DELETE FROM ${this.quote(this.tableName)} WHERE name = ?`,
        [name]
      );
    }
  }

  /**
   * Returns a specific migration record by name, or null if not found.
   */
  async getByName(name: string): Promise<MigrationRecord | null> {
    let rows: RawMigrationRow[];

    if (this.dialect === "postgres") {
      rows = await this.adapter.query<RawMigrationRow>(
        `SELECT * FROM ${this.quote(this.tableName)} WHERE name = $1`,
        [name]
      );
    } else {
      rows = await this.adapter.query<RawMigrationRow>(
        `SELECT * FROM ${this.quote(this.tableName)} WHERE name = ?`,
        [name]
      );
    }

    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  /**
   * Checks whether a migration has been executed.
   */
  async isExecuted(name: string): Promise<boolean> {
    const record = await this.getByName(name);
    return record !== null;
  }

  // ----------------------------------------------------------
  //  Checksum Validation
  // ----------------------------------------------------------

  /**
   * Validates that all executed migrations still match their stored checksums.
   * Detects accidental edits to already-executed migration files.
   *
   * @param migrations - Map of migration name → current checksum
   * @throws ChecksumMismatchError if any checksum has changed
   */
  async validateChecksums(
    migrations: Map<string, string>
  ): Promise<void> {
    const executed = await this.getExecuted();

    for (const record of executed) {
      const currentChecksum = migrations.get(record.name);

      // If the migration file no longer exists, skip (it was deleted)
      if (currentChecksum === undefined) continue;

      if (currentChecksum !== record.checksum) {
        throw new ChecksumMismatchError(record.name, record.checksum, currentChecksum);
      }
    }
  }

  // ----------------------------------------------------------
  //  Table Existence Check
  // ----------------------------------------------------------

  /**
   * Returns true if the migrations history table exists in the database.
   * Used to detect first-run scenarios.
   */
  async tableExists(): Promise<boolean> {
    try {
      if (this.dialect === "postgres") {
        const rows = await this.adapter.query<{ exists: boolean }>(
          `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = $1
          ) AS exists`,
          [this.tableName]
        );
        return rows[0]?.exists === true;
      } else if (this.dialect === "mysql") {
        const rows = await this.adapter.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM information_schema.tables
           WHERE table_name = ?`,
          [this.tableName]
        );
        return (rows[0]?.count ?? 0) > 0;
      } else {
        // SQLite
        const rows = await this.adapter.query<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          [this.tableName]
        );
        return rows.length > 0;
      }
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------
  //  Helpers
  // ----------------------------------------------------------

  private quote(name: string): string {
    switch (this.dialect) {
      case "postgres":
        return `"${name}"`;
      case "mysql":
        return `\`${name}\``;
      case "sqlite":
        return `"${name}"`;
    }
  }

  private mapRow(row: RawMigrationRow): MigrationRecord {
    return {
      id: Number(row.id),
      name: String(row.name),
      timestamp: Number(row.timestamp),
      executedAt: row.executed_at instanceof Date
        ? row.executed_at
        : new Date(String(row.executed_at)),
      checksum: String(row.checksum),
      durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
    };
  }
}

// Internal type for raw DB rows
interface RawMigrationRow {
  id: number | string;
  name: string;
  timestamp: number | string;
  executed_at: Date | string;
  checksum: string;
  duration_ms: number | null;
}
