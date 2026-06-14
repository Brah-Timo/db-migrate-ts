/**
 * @file migration-builder.test.ts
 * @description Unit tests for MigrationBuilderImpl.
 *
 * Tests that operations are correctly recorded and that
 * validation rules (empty schema, rename to same name, etc.) work.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { MigrationBuilderImpl } from "../../../src/migration/migration-builder.js";
import { EmptyTableSchemaError, InvalidRenameError } from "../../../src/utils/errors.js";

describe("MigrationBuilderImpl", () => {
  let builder: MigrationBuilderImpl;

  beforeEach(() => {
    builder = new MigrationBuilderImpl("postgres");
  });

  // ──────────────────────────────────────────────────────────
  //  Operation Recording
  // ──────────────────────────────────────────────────────────
  describe("Operation recording", () => {
    it("starts with no operations", () => {
      expect(builder.isEmpty()).toBe(true);
      expect(builder.getOperationCount()).toBe(0);
    });

    it("records createTable operation", () => {
      builder.createTable("users", {
        id: { schema: z.number().int(), primaryKey: true },
      });

      const ops = builder.getOperations();
      expect(ops).toHaveLength(1);
      expect(ops[0]?.type).toBe("CREATE_TABLE");
    });

    it("records addColumn operation", () => {
      builder.addColumn("users" as never, "age", {
        schema: z.number().int(),
        nullable: true,
      });

      const ops = builder.getOperations();
      expect(ops[0]?.type).toBe("ADD_COLUMN");
    });

    it("records raw SQL operation", () => {
      builder.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
      const ops = builder.getOperations();
      expect(ops[0]?.type).toBe("RAW_SQL");
    });

    it("supports method chaining", () => {
      const result = builder
        .createTable("products", {
          id: { schema: z.number().int(), primaryKey: true },
        })
        .createIndex("products" as never, ["id"] as never[]);

      expect(result).toBe(builder); // Same instance
      expect(builder.getOperationCount()).toBe(2);
    });

    it("records all operation types correctly", () => {
      builder
        .createTable("t", { id: { schema: z.number().int(), primaryKey: true } })
        .dropTable("t" as never)
        .renameTable("t" as never, "u")
        .addColumn("t" as never, "col", { schema: z.string() })
        .dropColumn("t" as never, "col" as never)
        .renameColumn("t" as never, "col" as never, "new_col")
        .createIndex("t" as never, ["col"] as never[])
        .dropIndex("idx_name")
        .raw("SELECT 1");

      expect(builder.getOperationCount()).toBe(9);
    });
  });

  // ──────────────────────────────────────────────────────────
  //  Validation
  // ──────────────────────────────────────────────────────────
  describe("Validation", () => {
    it("throws EmptyTableSchemaError for createTable with empty schema", () => {
      expect(() => builder.createTable("users", {})).toThrow(EmptyTableSchemaError);
    });

    it("throws InvalidRenameError when renameTable from === to", () => {
      expect(() => builder.renameTable("users" as never, "users")).toThrow(
        InvalidRenameError
      );
    });

    it("throws InvalidRenameError when renameColumn from === to", () => {
      expect(() =>
        builder.renameColumn("users" as never, "email" as never, "email")
      ).toThrow(InvalidRenameError);
    });

    it("throws for empty raw SQL", () => {
      expect(() => builder.raw("")).toThrow();
      expect(() => builder.raw("   ")).toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────
  //  Clear & Summarize
  // ──────────────────────────────────────────────────────────
  describe("Clear and summarize", () => {
    it("clear() removes all operations", () => {
      builder.createTable("t", { id: { schema: z.number().int(), primaryKey: true } });
      expect(builder.getOperationCount()).toBe(1);
      builder.clear();
      expect(builder.isEmpty()).toBe(true);
    });

    it("summarize() returns (no operations) when empty", () => {
      expect(builder.summarize()).toBe("(no operations)");
    });

    it("summarize() returns numbered list when operations present", () => {
      builder.createTable("users", {
        id: { schema: z.number().int(), primaryKey: true },
      });
      const summary = builder.summarize();
      expect(summary).toContain("1.");
      expect(summary).toContain("CREATE TABLE");
    });
  });
});
