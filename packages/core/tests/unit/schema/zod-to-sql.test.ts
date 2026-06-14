/**
 * @file zod-to-sql.test.ts
 * @description Unit tests for the ZodToSQLConverter.
 *
 * Tests cover all supported Zod types, all three dialects,
 * and all constraint combinations (nullable, defaults, PKs, etc.)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { ZodToSQLConverter } from "../../../src/schema/zod-to-sql.js";

describe("ZodToSQLConverter", () => {
  // ──────────────────────────────────────────────────────────
  //  PostgreSQL Dialect
  // ──────────────────────────────────────────────────────────
  describe("PostgreSQL dialect", () => {
    let converter: ZodToSQLConverter;

    beforeEach(() => {
      converter = new ZodToSQLConverter("postgres");
    });

    // --- String types ---
    describe("String types", () => {
      it("converts z.string() to TEXT NOT NULL", () => {
        expect(converter.convert({ schema: z.string() })).toBe("TEXT NOT NULL");
      });

      it("converts z.string().max(100) to VARCHAR(100) NOT NULL", () => {
        expect(converter.convert({ schema: z.string().max(100) })).toBe(
          "VARCHAR(100) NOT NULL"
        );
      });

      it("converts z.string().max(500) to VARCHAR(500) NOT NULL", () => {
        expect(converter.convert({ schema: z.string().max(500) })).toBe(
          "VARCHAR(500) NOT NULL"
        );
      });

      it("converts z.string().uuid() to UUID NOT NULL", () => {
        expect(converter.convert({ schema: z.string().uuid() })).toBe("UUID NOT NULL");
      });

      it("converts z.string().email() to VARCHAR(254) NOT NULL", () => {
        expect(converter.convert({ schema: z.string().email() })).toBe(
          "VARCHAR(254) NOT NULL"
        );
      });

      it("converts z.string().ip() to INET NOT NULL", () => {
        expect(converter.convert({ schema: z.string().ip() })).toBe("INET NOT NULL");
      });
    });

    // --- Number types ---
    describe("Number types", () => {
      it("converts z.number().int() to INTEGER NOT NULL", () => {
        expect(converter.convert({ schema: z.number().int() })).toBe("INTEGER NOT NULL");
      });

      it("converts z.number() (float) to DOUBLE PRECISION NOT NULL", () => {
        expect(converter.convert({ schema: z.number() })).toBe(
          "DOUBLE PRECISION NOT NULL"
        );
      });

      it("converts z.number().int() with large max to BIGINT NOT NULL", () => {
        expect(
          converter.convert({ schema: z.number().int().max(10_000_000_000) })
        ).toBe("BIGINT NOT NULL");
      });

      it("converts z.bigint() to BIGINT NOT NULL", () => {
        expect(converter.convert({ schema: z.bigint() })).toBe("BIGINT NOT NULL");
      });
    });

    // --- Boolean ---
    describe("Boolean types", () => {
      it("converts z.boolean() to BOOLEAN NOT NULL", () => {
        expect(converter.convert({ schema: z.boolean() })).toBe("BOOLEAN NOT NULL");
      });

      it("converts z.boolean() with default false to BOOLEAN NOT NULL DEFAULT FALSE", () => {
        expect(converter.convert({ schema: z.boolean(), default: false })).toBe(
          "BOOLEAN NOT NULL DEFAULT FALSE"
        );
      });

      it("converts z.boolean() with default true to BOOLEAN NOT NULL DEFAULT TRUE", () => {
        expect(converter.convert({ schema: z.boolean(), default: true })).toBe(
          "BOOLEAN NOT NULL DEFAULT TRUE"
        );
      });
    });

    // --- Date ---
    describe("Date types", () => {
      it("converts z.date() to TIMESTAMPTZ NOT NULL", () => {
        expect(converter.convert({ schema: z.date() })).toBe("TIMESTAMPTZ NOT NULL");
      });
    });

    // --- JSON ---
    describe("JSON types", () => {
      it("converts z.object() to JSONB NOT NULL", () => {
        expect(converter.convert({ schema: z.object({ foo: z.string() }) })).toBe(
          "JSONB NOT NULL"
        );
      });

      it("converts z.array() to JSONB NOT NULL", () => {
        expect(converter.convert({ schema: z.array(z.string()) })).toBe("JSONB NOT NULL");
      });
    });

    // --- Enum ---
    describe("Enum types", () => {
      it("converts z.enum() to TEXT NOT NULL", () => {
        expect(
          converter.convert({ schema: z.enum(["admin", "user", "moderator"]) })
        ).toBe("TEXT NOT NULL");
      });
    });

    // --- Nullability ---
    describe("Nullability", () => {
      it("converts z.string().optional() to TEXT (no NOT NULL)", () => {
        expect(converter.convert({ schema: z.string().optional() })).toBe("TEXT");
      });

      it("converts z.string().nullable() to TEXT (no NOT NULL)", () => {
        expect(converter.convert({ schema: z.string().nullable() })).toBe("TEXT");
      });

      it("respects nullable: true flag", () => {
        expect(converter.convert({ schema: z.string(), nullable: true })).toBe("TEXT");
      });

      it("respects nullable: false flag (explicit NOT NULL)", () => {
        expect(converter.convert({ schema: z.string(), nullable: false })).toBe(
          "TEXT NOT NULL"
        );
      });
    });

    // --- Constraints ---
    describe("Constraints", () => {
      it("adds PRIMARY KEY constraint", () => {
        expect(converter.convert({ schema: z.number().int(), primaryKey: true })).toBe(
          "INTEGER NOT NULL PRIMARY KEY"
        );
      });

      it("adds UNIQUE constraint", () => {
        expect(converter.convert({ schema: z.string().email(), unique: true })).toBe(
          "VARCHAR(254) NOT NULL UNIQUE"
        );
      });

      it("adds DEFAULT string value", () => {
        expect(converter.convert({ schema: z.string().max(50), default: "guest" })).toBe(
          "VARCHAR(50) NOT NULL DEFAULT 'guest'"
        );
      });

      it("adds DEFAULT numeric value", () => {
        expect(converter.convert({ schema: z.number().int(), default: 0 })).toBe(
          "INTEGER NOT NULL DEFAULT 0"
        );
      });

      it("passes SQL functions through as-is for DEFAULT", () => {
        expect(
          converter.convert({ schema: z.string().uuid(), default: "gen_random_uuid()" })
        ).toBe("UUID NOT NULL DEFAULT gen_random_uuid()");
      });

      it("adds inline FOREIGN KEY reference", () => {
        const result = converter.convert({
          schema: z.string().uuid(),
          references: {
            table: "users",
            column: "id",
            onDelete: "CASCADE",
          },
        });
        expect(result).toContain('REFERENCES "users"("id")');
        expect(result).toContain("ON DELETE CASCADE");
      });
    });
  });

  // ──────────────────────────────────────────────────────────
  //  MySQL Dialect
  // ──────────────────────────────────────────────────────────
  describe("MySQL dialect", () => {
    let converter: ZodToSQLConverter;

    beforeEach(() => {
      converter = new ZodToSQLConverter("mysql");
    });

    it("converts z.boolean() to TINYINT(1) NOT NULL", () => {
      expect(converter.convert({ schema: z.boolean() })).toBe("TINYINT(1) NOT NULL");
    });

    it("converts z.boolean() default false to TINYINT(1) NOT NULL DEFAULT 0", () => {
      expect(converter.convert({ schema: z.boolean(), default: false })).toBe(
        "TINYINT(1) NOT NULL DEFAULT 0"
      );
    });

    it("converts z.date() to DATETIME NOT NULL", () => {
      expect(converter.convert({ schema: z.date() })).toBe("DATETIME NOT NULL");
    });

    it("converts z.object() to JSON NOT NULL", () => {
      expect(converter.convert({ schema: z.object({}) })).toBe("JSON NOT NULL");
    });

    it("converts z.number().int() to INT NOT NULL", () => {
      expect(converter.convert({ schema: z.number().int() })).toBe("INT NOT NULL");
    });

    it("converts z.string().ip() to VARCHAR(45) NOT NULL", () => {
      expect(converter.convert({ schema: z.string().ip() })).toBe("VARCHAR(45) NOT NULL");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  SQLite Dialect
  // ──────────────────────────────────────────────────────────
  describe("SQLite dialect", () => {
    let converter: ZodToSQLConverter;

    beforeEach(() => {
      converter = new ZodToSQLConverter("sqlite");
    });

    it("converts z.boolean() to INTEGER NOT NULL", () => {
      expect(converter.convert({ schema: z.boolean() })).toBe("INTEGER NOT NULL");
    });

    it("converts z.date() to TEXT NOT NULL (ISO 8601)", () => {
      expect(converter.convert({ schema: z.date() })).toBe("TEXT NOT NULL");
    });

    it("converts z.object() to TEXT NOT NULL", () => {
      expect(converter.convert({ schema: z.object({}) })).toBe("TEXT NOT NULL");
    });

    it("converts z.string().uuid() to VARCHAR(36) NOT NULL", () => {
      expect(converter.convert({ schema: z.string().uuid() })).toBe(
        "VARCHAR(36) NOT NULL"
      );
    });

    it("converts z.string().ip() to VARCHAR(45) NOT NULL", () => {
      expect(converter.convert({ schema: z.string().ip() })).toBe("VARCHAR(45) NOT NULL");
    });
  });

  // ──────────────────────────────────────────────────────────
  //  ZodDefault wrapper
  // ──────────────────────────────────────────────────────────
  describe("ZodDefault wrapper", () => {
    it("unwraps z.string().default() correctly for postgres", () => {
      const converter = new ZodToSQLConverter("postgres");
      expect(converter.convert({ schema: z.string().default("active") })).toBe(
        "TEXT NOT NULL"
      );
    });
  });
});
