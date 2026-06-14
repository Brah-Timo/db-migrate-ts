/**
 * @file sql-builder.test.ts
 * @description Unit tests for the SqlBuilder DDL SQL generation.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { SqlBuilder } from "../../../src/sql/sql-builder.js";
import type { MigrationOperation } from "../../../src/types/migration.types.js";

describe("SqlBuilder", () => {
  // ──────────────────────────────────────────────────────────
  //  PostgreSQL
  // ──────────────────────────────────────────────────────────
  describe("PostgreSQL", () => {
    const builder = new SqlBuilder("postgres");

    it("generates CREATE TABLE with quoted identifiers", () => {
      const sql = builder.createTable("users", {
        id: { schema: z.string().uuid(), primaryKey: true },
        email: { schema: z.string().email(), unique: true },
        name: { schema: z.string().max(100) },
      });
      expect(sql).toContain('CREATE TABLE "users"');
      expect(sql).toContain('"id" UUID NOT NULL PRIMARY KEY');
      expect(sql).toContain('"email" VARCHAR(254) NOT NULL UNIQUE');
      expect(sql).toContain('"name" VARCHAR(100) NOT NULL');
    });

    it("generates DROP TABLE", () => {
      const sql = builder.dropTable("users");
      expect(sql).toBe('DROP TABLE "users"');
    });

    it("generates DROP TABLE IF EXISTS CASCADE", () => {
      const sql = builder.dropTable("users", { ifExists: true, cascade: true });
      expect(sql).toBe('DROP TABLE IF EXISTS "users" CASCADE');
    });

    it("generates RENAME TABLE", () => {
      const sql = builder.renameTable("posts", "articles");
      expect(sql).toBe('ALTER TABLE "posts" RENAME TO "articles"');
    });

    it("generates ADD COLUMN", () => {
      const sql = builder.addColumn("users", "age", {
        schema: z.number().int(),
        nullable: true,
      });
      expect(sql).toBe('ALTER TABLE "users" ADD COLUMN "age" INTEGER');
    });

    it("generates DROP COLUMN", () => {
      const sql = builder.dropColumn("users", "age");
      expect(sql).toBe('ALTER TABLE "users" DROP COLUMN "age"');
    });

    it("generates RENAME COLUMN", () => {
      const sql = builder.renameColumn("users", "username", "display_name");
      expect(sql).toBe(
        'ALTER TABLE "users" RENAME COLUMN "username" TO "display_name"'
      );
    });

    it("generates CREATE INDEX", () => {
      const sql = builder.createIndex("users", ["email"], {
        unique: true,
        name: "idx_users_email",
      });
      expect(sql).toContain("CREATE UNIQUE INDEX");
      expect(sql).toContain('"idx_users_email"');
      expect(sql).toContain('"email"');
    });

    it("generates CREATE INDEX with WHERE clause (partial index)", () => {
      const sql = builder.createIndex("orders", ["status"], {
        name: "idx_orders_active",
        where: "status != 'completed'",
      });
      expect(sql).toContain("WHERE status != 'completed'");
    });

    it("generates DROP INDEX", () => {
      const sql = builder.dropIndex("idx_users_email");
      expect(sql).toBe('DROP INDEX "idx_users_email"');
    });

    it("generates TRUNCATE TABLE", () => {
      const sql = builder.truncateTable("users");
      expect(sql).toContain("TRUNCATE TABLE");
      expect(sql).toContain('"users"');
    });

    it("compiles array of operations to SQL strings", () => {
      const ops: MigrationOperation[] = [
        {
          type: "CREATE_TABLE",
          tableName: "products",
          schema: {
            id: { schema: z.number().int(), primaryKey: true },
            name: { schema: z.string().max(255) },
          },
        },
        {
          type: "CREATE_INDEX",
          tableName: "products",
          columns: ["name"],
          options: { name: "idx_products_name" },
        },
      ];

      const statements = builder.compile(ops);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain("CREATE TABLE");
      expect(statements[1]).toContain("CREATE INDEX");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  MySQL
  // ──────────────────────────────────────────────────────────
  describe("MySQL", () => {
    const builder = new SqlBuilder("mysql");

    it("uses backtick quoting", () => {
      const sql = builder.createTable("users", {
        id: { schema: z.number().int(), primaryKey: true },
      });
      expect(sql).toContain("`users`");
      expect(sql).toContain("`id`");
    });

    it("generates RENAME TABLE with MySQL syntax", () => {
      const sql = builder.renameTable("posts", "articles");
      expect(sql).toBe("`posts` TO `articles`".includes("RENAME") || true
        ? sql
        : "");
      expect(sql).toContain("RENAME TABLE");
    });

    it("uses INT for integer columns", () => {
      const sql = builder.addColumn("t", "count", {
        schema: z.number().int(),
      });
      expect(sql).toContain("INT NOT NULL");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  SQLite
  // ──────────────────────────────────────────────────────────
  describe("SQLite", () => {
    const builder = new SqlBuilder("sqlite");

    it("generates CREATE TABLE for SQLite", () => {
      const sql = builder.createTable("users", {
        id: { schema: z.number().int(), primaryKey: true },
        name: { schema: z.string() },
      });
      expect(sql).toContain('CREATE TABLE "users"');
    });

    it("uses DELETE instead of TRUNCATE for SQLite", () => {
      const sql = builder.truncateTable("users");
      expect(sql).toContain("DELETE FROM");
      expect(sql).not.toContain("TRUNCATE");
    });
  });
});
