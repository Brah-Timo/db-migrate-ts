/**
 * @file migration-runner.test.ts
 * @description Integration tests for MigrationRunner using SQLite in-memory.
 *
 * These tests run against a real (in-memory) SQLite database to verify
 * that the full migration pipeline works end-to-end:
 * history table creation → migration execution → rollback → status reporting
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { Migration } from "../../src/types/migration.types.js";

// We need better-sqlite3 for integration tests
// These tests are skipped if better-sqlite3 isn't available

let Database: typeof import("better-sqlite3");
let SQLiteAdapter: typeof import("../../src/dialects/sqlite.dialect.js").SQLiteAdapter;
let MigrationRunner: typeof import("../../src/migration/migration-runner.js").MigrationRunner;

try {
  Database = ((await import("better-sqlite3")).default) as typeof import("better-sqlite3");
  SQLiteAdapter = (await import("../../src/dialects/sqlite.dialect.js")).SQLiteAdapter;
  MigrationRunner = (await import("../../src/migration/migration-runner.js")).MigrationRunner;
} catch {
  // better-sqlite3 not available — tests will be skipped
}

// ──────────────────────────────────────────────────────────
//  Test Migrations
// ──────────────────────────────────────────────────────────

const createUsersTable: Migration = {
  name: "001_create_users",
  timestamp: 1,
  up: (migrate) => {
    migrate.createTable("users", {
      id: { schema: z.number().int(), primaryKey: true },
      name: { schema: z.string().max(100) },
      email: { schema: z.string().email(), unique: true },
    });
  },
  down: (migrate) => {
    migrate.dropTable("users" as never);
  },
};

const addAgeToUsers: Migration = {
  name: "002_add_age_to_users",
  timestamp: 2,
  up: (migrate) => {
    migrate.addColumn("users" as never, "age", {
      schema: z.number().int(),
      nullable: true,
    });
  },
  down: (migrate) => {
    migrate.dropColumn("users" as never, "age" as never);
  },
};

const createPostsTable: Migration = {
  name: "003_create_posts",
  timestamp: 3,
  up: (migrate) => {
    migrate.createTable("posts", {
      id: { schema: z.number().int(), primaryKey: true },
      title: { schema: z.string().max(255) },
      content: { schema: z.string() },
    });
  },
  down: (migrate) => {
    migrate.dropTable("posts" as never);
  },
};

const allMigrations = [createUsersTable, addAgeToUsers, createPostsTable];

// ──────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────

describe.skipIf(!Database)("MigrationRunner Integration (SQLite)", () => {
  let db: InstanceType<typeof Database>;
  let adapter: InstanceType<typeof SQLiteAdapter>;
  let runner: InstanceType<typeof MigrationRunner>;

  beforeEach(() => {
    // Fresh in-memory DB for each test
    db = new Database(":memory:");
    adapter = new SQLiteAdapter(db);
    adapter.enableForeignKeys();
    runner = new MigrationRunner(adapter, { dialect: "sqlite" });
  });

  afterEach(() => {
    db.close();
  });

  // ──────────────────────────────────────────────────────────
  //  UP — Apply migrations
  // ──────────────────────────────────────────────────────────
  describe("up()", () => {
    it("creates the history table on first run", async () => {
      await runner.up([createUsersTable]);
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='_db_migrate_ts_history'`
        )
        .all();
      expect(tables).toHaveLength(1);
    });

    it("creates the users table after migration", async () => {
      await runner.up([createUsersTable]);
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`)
        .all();
      expect(tables).toHaveLength(1);
    });

    it("records migration in history table", async () => {
      await runner.up([createUsersTable]);
      const records = db
        .prepare(`SELECT * FROM _db_migrate_ts_history`)
        .all() as Array<{ name: string }>;
      expect(records).toHaveLength(1);
      expect(records[0]?.name).toBe("001_create_users");
    });

    it("runs migrations in timestamp order", async () => {
      // Provide in reverse order — should still execute in order
      await runner.up([createPostsTable, createUsersTable, addAgeToUsers]);

      const records = db
        .prepare(`SELECT name FROM _db_migrate_ts_history ORDER BY timestamp ASC`)
        .all() as Array<{ name: string }>;

      expect(records.map((r) => r.name)).toEqual([
        "001_create_users",
        "002_add_age_to_users",
        "003_create_posts",
      ]);
    });

    it("skips already-executed migrations on second run", async () => {
      await runner.up([createUsersTable]);
      await runner.up([createUsersTable]); // Second call

      const records = db
        .prepare(`SELECT * FROM _db_migrate_ts_history`)
        .all() as unknown[];
      expect(records).toHaveLength(1); // Still only 1 record
    });

    it("runs all 3 migrations successfully", async () => {
      await runner.up(allMigrations);

      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
        )
        .all() as Array<{ name: string }>;

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("posts");
      expect(tableNames).toContain("_db_migrate_ts_history");
    });

    it("adds column via ADD COLUMN migration", async () => {
      await runner.up([createUsersTable, addAgeToUsers]);

      // Check 'age' column exists
      const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{
        name: string;
      }>;
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).toContain("age");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  DOWN — Rollback
  // ──────────────────────────────────────────────────────────
  describe("down()", () => {
    it("rolls back the last migration", async () => {
      await runner.up(allMigrations);
      await runner.down(allMigrations, 1);

      // posts table should be gone
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='posts'`)
        .all();
      expect(tables).toHaveLength(0);
    });

    it("removes migration record after rollback", async () => {
      await runner.up([createUsersTable]);
      await runner.down([createUsersTable], 1);

      const records = db
        .prepare(`SELECT * FROM _db_migrate_ts_history`)
        .all() as unknown[];
      expect(records).toHaveLength(0);
    });

    it("rolls back 2 steps correctly", async () => {
      await runner.up(allMigrations);
      await runner.down(allMigrations, 2);

      const records = db
        .prepare(`SELECT * FROM _db_migrate_ts_history`)
        .all() as unknown[];
      expect(records).toHaveLength(1); // Only migration 1 should remain
    });

    it("returns empty array if no migrations to rollback", async () => {
      const result = await runner.down(allMigrations, 1);
      expect(result.rolledBack).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────
  //  STATUS
  // ──────────────────────────────────────────────────────────
  describe("status()", () => {
    it("shows all migrations as pending initially", async () => {
      const status = await runner.status(allMigrations);
      const pending = status.filter((s) => s.status === "pending");
      expect(pending).toHaveLength(3);
    });

    it("shows executed migrations after up()", async () => {
      await runner.up([createUsersTable]);
      const status = await runner.status(allMigrations);

      const executed = status.filter((s) => s.status === "executed");
      const pending = status.filter((s) => s.status === "pending");

      expect(executed).toHaveLength(1);
      expect(pending).toHaveLength(2);
      expect(executed[0]?.name).toBe("001_create_users");
    });

    it("includes executedAt timestamp for executed migrations", async () => {
      await runner.up([createUsersTable]);
      const status = await runner.status(allMigrations);

      const executed = status.find((s) => s.status === "executed");
      expect(executed?.executedAt).toBeDefined();
      expect(executed?.executedAt).toBeInstanceOf(Date);
    });

    it("validates checksums (valid = true for fresh migration)", async () => {
      await runner.up([createUsersTable]);
      const status = await runner.status(allMigrations);

      const executed = status.find((s) => s.status === "executed");
      expect(executed?.checksumValid).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────
  //  DRY RUN
  // ──────────────────────────────────────────────────────────
  describe("dry run mode", () => {
    it("does not create tables in dry run mode", async () => {
      const dryRunner = new MigrationRunner(adapter, {
        dialect: "sqlite",
        dryRun: true,
      });

      await dryRunner.up([createUsersTable]);

      // No tables should exist (dry run)
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`)
        .all();
      expect(tables).toHaveLength(0);
    });
  });
});
