/**
 * @file zod-to-sql.ts
 * @description The core Zod → SQL type converter.
 *
 * This converter inspects Zod schema instances at runtime to determine the
 * correct SQL column type and constraints for each supported database dialect.
 *
 * It handles Zod's wrapper types (ZodOptional, ZodNullable, ZodDefault) by
 * unwrapping them to reach the inner type, while also extracting constraint
 * information from Zod's internal `_def.checks` array.
 */

import { z } from "zod";
import type { ColumnDefinition } from "../types/column.types.js";
import type { ColumnTypeConverter } from "../types/dialect.types.js";
import type { Dialect } from "../types/migration.types.js";

// ============================================================
//  ZodToSQL Converter Implementation
// ============================================================

/**
 * Converts Zod column definitions to SQL type strings for a specific dialect.
 *
 * @example
 * const converter = new ZodToSQLConverter("postgres");
 *
 * converter.convert({ schema: z.string().max(100) })
 * // → "VARCHAR(100) NOT NULL"
 *
 * converter.convert({ schema: z.boolean(), default: false })
 * // → "BOOLEAN NOT NULL DEFAULT FALSE"
 *
 * converter.convert({ schema: z.string().uuid(), primaryKey: true })
 * // → "UUID NOT NULL PRIMARY KEY"
 */
export class ZodToSQLConverter implements ColumnTypeConverter {
  constructor(private readonly dialect: Dialect) {}

  // ----------------------------------------------------------
  //  Public API
  // ----------------------------------------------------------

  /**
   * Returns the full SQL column definition: base type + all constraints.
   */
  convert(definition: ColumnDefinition): string {
    const baseType = this.getBaseType(definition);
    const constraints = this.buildConstraints(definition);
    return constraints ? `${baseType} ${constraints}` : baseType;
  }

  /**
   * Returns only the base SQL type string, without any constraints.
   */
  getBaseType(definition: ColumnDefinition): string {
    return this.resolveType(definition.schema);
  }

  // ----------------------------------------------------------
  //  Type Resolution
  // ----------------------------------------------------------

  /**
   * Resolves a Zod schema to its SQL base type, unwrapping wrappers first.
   */
  private resolveType(schema: z.ZodTypeAny): string {
    // Unwrap Optional / Nullable / Default wrappers to get the real inner type
    const inner = this.unwrap(schema);

    if (inner instanceof z.ZodString) return this.resolveString(inner);
    if (inner instanceof z.ZodNumber) return this.resolveNumber(inner);
    if (inner instanceof z.ZodBigInt) return this.resolveBigInt();
    if (inner instanceof z.ZodBoolean) return this.resolveBoolean();
    if (inner instanceof z.ZodDate) return this.resolveDate();
    if (inner instanceof z.ZodEnum) return this.resolveEnum();
    if (inner instanceof z.ZodNativeEnum) return this.resolveNativeEnum(inner);
    if (inner instanceof z.ZodArray) return this.resolveJson();
    if (inner instanceof z.ZodObject) return this.resolveJson();
    if (inner instanceof z.ZodRecord) return this.resolveJson();
    if (inner instanceof z.ZodUnknown) return "TEXT";
    if (inner instanceof z.ZodAny) return "TEXT";
    if (inner instanceof z.ZodLiteral) return this.resolveLiteral(inner);
    if (inner instanceof z.ZodNull) return "TEXT";
    if (inner instanceof z.ZodUndefined) return "TEXT";

    // Fallback — any unrecognized Zod type becomes TEXT
    return "TEXT";
  }

  // ----------------------------------------------------------
  //  String Resolution
  // ----------------------------------------------------------

  private resolveString(schema: z.ZodString): string {
    const checks = schema._def.checks;

    // UUID detection
    const isUUID = checks.some((c) => c.kind === "uuid");
    if (isUUID) {
      return this.dialect === "postgres" ? "UUID" : "VARCHAR(36)";
    }

    // CUID detection
    const isCUID = checks.some((c) => c.kind === "cuid" || c.kind === "cuid2");
    if (isCUID) return "VARCHAR(36)";

    // NanoID detection
    const isNanoID = checks.some((c) => c.kind === "nanoid");
    if (isNanoID) return "VARCHAR(21)";

    // Email address
    const isEmail = checks.some((c) => c.kind === "email");
    if (isEmail) return "VARCHAR(254)"; // RFC 5321 maximum

    // URL
    const isURL = checks.some((c) => c.kind === "url");
    if (isURL) return "TEXT";

    // IP address
    const isIP = checks.some((c) => c.kind === "ip");
    if (isIP) {
      return this.dialect === "postgres" ? "INET" : "VARCHAR(45)";
    }

    // Date/time strings
    const isDatetime = checks.some((c) => c.kind === "datetime");
    if (isDatetime) {
      return this.dialect === "postgres" ? "TIMESTAMPTZ" : "DATETIME";
    }

    // Explicit max length → VARCHAR
    const maxCheck = checks.find((c) => c.kind === "max") as
      | { kind: "max"; value: number }
      | undefined;
    if (maxCheck) {
      const len = maxCheck.value;
      // Very long strings go to TEXT, short ones to VARCHAR
      return len <= 65535 ? `VARCHAR(${len})` : "TEXT";
    }

    // Fixed exact length
    const lenCheck = checks.find((c) => c.kind === "length") as
      | { kind: "length"; value: number }
      | undefined;
    if (lenCheck) {
      return this.dialect === "sqlite" ? "TEXT" : `CHAR(${lenCheck.value})`;
    }

    // Default for unconstrained strings
    return "TEXT";
  }

  // ----------------------------------------------------------
  //  Number Resolution
  // ----------------------------------------------------------

  private resolveNumber(schema: z.ZodNumber): string {
    const checks = schema._def.checks;
    const isInt = checks.some((c) => c.kind === "int");
    const isFinite = checks.some((c) => c.kind === "finite");

    if (!isInt) {
      // Floating point
      switch (this.dialect) {
        case "postgres":
          return "DOUBLE PRECISION";
        case "mysql":
          return "DOUBLE";
        case "sqlite":
          return "REAL";
      }
    }

    // Integer — check if we need BIGINT (> 32-bit range)
    const maxCheck = checks.find((c) => c.kind === "max") as
      | { kind: "max"; value: number }
      | undefined;
    const minCheck = checks.find((c) => c.kind === "min") as
      | { kind: "min"; value: number }
      | undefined;

    const needsBigInt =
      (maxCheck && maxCheck.value > 2_147_483_647) ||
      (minCheck && minCheck.value < -2_147_483_648);

    if (needsBigInt) {
      return "BIGINT";
    }

    // Check for small integer range (0-255 → SMALLINT)
    const isSmall =
      maxCheck && maxCheck.value <= 32767 && (!minCheck || minCheck.value >= -32768);
    if (isSmall) {
      return this.dialect === "postgres" ? "SMALLINT" : "SMALLINT";
    }

    // Standard integer
    switch (this.dialect) {
      case "postgres":
        return "INTEGER";
      case "mysql":
        return "INT";
      case "sqlite":
        return "INTEGER";
    }
  }

  // ----------------------------------------------------------
  //  Other Type Resolutions
  // ----------------------------------------------------------

  private resolveBigInt(): string {
    return "BIGINT";
  }

  private resolveBoolean(): string {
    switch (this.dialect) {
      case "postgres":
        return "BOOLEAN";
      case "mysql":
        return "TINYINT(1)";
      case "sqlite":
        // SQLite has no boolean; uses 0/1 integers
        return "INTEGER";
    }
  }

  private resolveDate(): string {
    switch (this.dialect) {
      case "postgres":
        return "TIMESTAMPTZ";
      case "mysql":
        return "DATETIME";
      case "sqlite":
        // SQLite stores dates as ISO 8601 strings
        return "TEXT";
    }
  }

  private resolveEnum(): string {
    // PostgreSQL supports native ENUM types, but they require CREATE TYPE first.
    // We use VARCHAR/TEXT here for portability — if you need PostgreSQL native enums,
    // use migrate.raw('CREATE TYPE ... AS ENUM (...)') before createTable.
    switch (this.dialect) {
      case "postgres":
        return "TEXT";
      case "mysql":
        return "VARCHAR(100)";
      case "sqlite":
        return "TEXT";
    }
  }

  private resolveNativeEnum(schema: z.ZodNativeEnum<Record<string, string | number>>): string {
    // Detect if it's a numeric enum
    const values = Object.values(schema.enum as Record<string, unknown>);
    const allNumeric = values.every((v) => typeof v === "number");

    if (allNumeric) {
      return this.dialect === "postgres" ? "SMALLINT" : "TINYINT";
    }

    return this.resolveEnum();
  }

  private resolveJson(): string {
    // PostgreSQL supports JSONB (binary JSON with indexing support)
    // MySQL supports JSON
    // SQLite stores JSON as TEXT
    switch (this.dialect) {
      case "postgres":
        return "JSONB";
      case "mysql":
        return "JSON";
      case "sqlite":
        return "TEXT";
    }
  }

  private resolveLiteral(schema: z.ZodLiteral<z.Primitive>): string {
    const value = schema.value;
    if (typeof value === "number") return this.dialect === "postgres" ? "INTEGER" : "INT";
    if (typeof value === "boolean") return this.resolveBoolean();
    return "TEXT";
  }

  // ----------------------------------------------------------
  //  Unwrapping
  // ----------------------------------------------------------

  /**
   * Recursively unwraps Zod wrapper types to reach the core type.
   * Handles: ZodOptional, ZodNullable, ZodDefault, ZodEffects, ZodBranded.
   */
  private unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
    if (schema instanceof z.ZodOptional) {
      return this.unwrap(schema.unwrap());
    }
    if (schema instanceof z.ZodNullable) {
      return this.unwrap(schema.unwrap());
    }
    if (schema instanceof z.ZodDefault) {
      return this.unwrap(schema._def.innerType as z.ZodTypeAny);
    }
    if (schema instanceof z.ZodEffects) {
      return this.unwrap(schema.innerType());
    }
    // ZodBranded wraps the inner type
    if ("_def" in schema && schema._def && typeof schema._def === "object") {
      const def = schema._def as { typeName?: string; type?: z.ZodTypeAny };
      if (def.typeName === "ZodBranded" && def.type) {
        return this.unwrap(def.type);
      }
    }
    return schema;
  }

  // ----------------------------------------------------------
  //  Nullability Detection
  // ----------------------------------------------------------

  /**
   * Determines whether a column definition allows NULL values.
   * Checks both explicit nullable flag and Zod wrapper types.
   */
  isNullable(definition: ColumnDefinition): boolean {
    if (definition.nullable === true) return true;
    if (definition.nullable === false) return false;

    const schema = definition.schema;
    if (schema instanceof z.ZodOptional) return true;
    if (schema instanceof z.ZodNullable) return true;
    // ZodDefault doesn't imply nullable
    return false;
  }

  // ----------------------------------------------------------
  //  Constraint Building
  // ----------------------------------------------------------

  /**
   * Builds the constraint string to append after the base type.
   * e.g. "NOT NULL PRIMARY KEY DEFAULT 'guest'"
   */
  private buildConstraints(definition: ColumnDefinition): string {
    const parts: string[] = [];

    // NULL / NOT NULL
    if (!this.isNullable(definition)) {
      parts.push("NOT NULL");
    }

    // PRIMARY KEY
    if (definition.primaryKey) {
      parts.push("PRIMARY KEY");
    }

    // UNIQUE (only if not a PK — PKs are already unique by definition)
    if (definition.unique && !definition.primaryKey) {
      parts.push("UNIQUE");
    }

    // DEFAULT
    if (definition.default !== undefined) {
      parts.push(`DEFAULT ${this.formatDefault(definition.default, definition.schema)}`);
    }

    // REFERENCES (inline foreign key)
    if (definition.references) {
      const ref = definition.references;
      let fk = `REFERENCES ${this.quoteIdent(ref.table)}(${this.quoteIdent(ref.column)})`;
      if (ref.onDelete) fk += ` ON DELETE ${ref.onDelete}`;
      if (ref.onUpdate) fk += ` ON UPDATE ${ref.onUpdate}`;
      parts.push(fk);
    }

    // CHECK constraints
    if (definition.checks?.length) {
      for (const check of definition.checks) {
        parts.push(`CONSTRAINT ${this.quoteIdent(check.name)} CHECK (${check.expression})`);
      }
    }

    return parts.join(" ");
  }

  /**
   * Formats a default value as a SQL literal.
   */
  private formatDefault(value: unknown, schema: z.ZodTypeAny): string {
    // Raw SQL expressions (functions like NOW(), gen_random_uuid(), etc.)
    if (
      typeof value === "string" &&
      (value.includes("(") || value.toUpperCase() === value)
    ) {
      // Heuristic: if the string contains '(' or is all caps, treat as SQL expression
      return value;
    }

    if (value === null) return "NULL";
    if (typeof value === "boolean") {
      const inner = this.unwrap(schema);
      if (inner instanceof z.ZodBoolean) {
        switch (this.dialect) {
          case "postgres":
            return value ? "TRUE" : "FALSE";
          case "mysql":
            return value ? "1" : "0";
          case "sqlite":
            return value ? "1" : "0";
        }
      }
    }
    if (typeof value === "number") return String(value);
    if (typeof value === "bigint") return String(value);
    if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }
    if (typeof value === "object") {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }

    return String(value);
  }

  /**
   * Quotes an identifier (table/column name) for the current dialect.
   */
  private quoteIdent(name: string): string {
    switch (this.dialect) {
      case "postgres":
        return `"${name.replace(/"/g, '""')}"`;
      case "mysql":
        return `\`${name.replace(/`/g, "``")}\``;
      case "sqlite":
        return `"${name.replace(/"/g, '""')}"`;
    }
  }
}
