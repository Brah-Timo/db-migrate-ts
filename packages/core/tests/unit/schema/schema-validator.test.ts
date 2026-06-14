/**
 * @file schema-validator.test.ts
 * @description Unit tests for the SchemaValidator.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { SchemaValidator } from "../../../src/schema/schema-validator.js";

describe("SchemaValidator", () => {
  const validator = new SchemaValidator();

  describe("valid schemas", () => {
    it("validates a simple valid schema", () => {
      const result = validator.validate({
        users: {
          id: { schema: z.number().int(), primaryKey: true },
          name: { schema: z.string().max(100) },
        },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("allows nullable columns without primary key warning", () => {
      const result = validator.validate({
        logs: {
          id: { schema: z.number().int(), primaryKey: true },
          message: { schema: z.string(), nullable: true },
        },
      });
      expect(result.valid).toBe(true);
    });

    it("warns about missing primary key", () => {
      const result = validator.validate({
        log_entries: {
          message: { schema: z.string() },
        },
      });
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("no primary key"))).toBe(true);
    });
  });

  describe("invalid schemas", () => {
    it("fails for empty table schema", () => {
      const result = validator.validate({ empty_table: {} });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("no columns"))).toBe(true);
    });

    it("fails for invalid table name with spaces", () => {
      const result = validator.validate({
        "my table": {
          id: { schema: z.number().int(), primaryKey: true },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("valid SQL identifier"))).toBe(true);
    });

    it("fails for primaryKey + nullable combination", () => {
      const result = validator.validate({
        users: {
          id: { schema: z.number().int(), primaryKey: true, nullable: true },
        },
      });
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("primaryKey") && e.includes("nullable"))
      ).toBe(true);
    });

    it("fails for invalid FK reference to non-existent table", () => {
      const result = validator.validate({
        posts: {
          id: { schema: z.number().int(), primaryKey: true },
          authorId: {
            schema: z.number().int(),
            references: { table: "nonexistent_table", column: "id" },
          },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("nonexistent_table"))).toBe(true);
    });

    it("fails for FK reference to non-existent column", () => {
      const result = validator.validate({
        users: {
          id: { schema: z.number().int(), primaryKey: true },
        },
        posts: {
          id: { schema: z.number().int(), primaryKey: true },
          authorId: {
            schema: z.number().int(),
            references: { table: "users", column: "nonexistent_column" },
          },
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("nonexistent_column"))).toBe(true);
    });

    it("warns about FK to non-unique column", () => {
      const result = validator.validate({
        users: {
          id: { schema: z.number().int(), primaryKey: true },
          name: { schema: z.string() }, // Not unique!
        },
        posts: {
          id: { schema: z.number().int(), primaryKey: true },
          authorName: {
            schema: z.string(),
            references: { table: "users", column: "name" },
          },
        },
      });
      expect(result.warnings.some((w) => w.includes("neither a primary key"))).toBe(true);
    });
  });

  describe("validateOrThrow", () => {
    it("throws SchemaValidationError for invalid schema", () => {
      expect(() =>
        validator.validateOrThrow({
          "invalid table name!": {},
        })
      ).toThrow();
    });

    it("does not throw for valid schema", () => {
      expect(() =>
        validator.validateOrThrow({
          users: {
            id: { schema: z.number().int(), primaryKey: true },
          },
        })
      ).not.toThrow();
    });
  });
});
