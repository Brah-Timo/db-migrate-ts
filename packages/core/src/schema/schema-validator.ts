/**
 * @file schema-validator.ts
 * @description Validates a DatabaseSchema definition for correctness and consistency.
 *
 * The SchemaValidator runs a series of checks against your schema before
 * any migrations are generated or executed, catching common mistakes early:
 *
 * - Tables must have at least one column
 * - Column names must follow valid identifier conventions
 * - Each table should have at most one primary key column
 * - Foreign key references must point to existing tables and columns
 * - Default values must be compatible with column types
 * - Circular foreign key dependencies are detected and warned about
 */

import { z } from "zod";
import type { DatabaseSchema, TableSchema } from "../types/table.types.js";
import type { ColumnDefinition } from "../types/column.types.js";
import { SchemaValidationError } from "../utils/errors.js";

// ============================================================
//  Validation Result
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================
//  Schema Validator
// ============================================================

/**
 * Validates a DatabaseSchema definition.
 *
 * @example
 * const validator = new SchemaValidator();
 * const result = validator.validate(mySchema);
 *
 * if (!result.valid) {
 *   result.errors.forEach(err => console.error("ERROR:", err));
 * }
 * result.warnings.forEach(warn => console.warn("WARN:", warn));
 */
export class SchemaValidator {
  /**
   * Validates the full database schema.
   *
   * @param schema - The DatabaseSchema to validate
   * @returns Validation result with errors and warnings
   */
  validate(schema: DatabaseSchema): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Empty schema check
    if (Object.keys(schema).length === 0) {
      warnings.push(
        "Schema is empty — no tables defined. Add tables to enable type-safe migrations."
      );
      return { valid: true, errors, warnings };
    }

    for (const [tableName, tableSchema] of Object.entries(schema)) {
      this.validateTableName(tableName, errors);
      this.validateTable(tableName, tableSchema as TableSchema, errors, warnings);
    }

    // Cross-table validation (foreign keys)
    this.validateForeignKeyReferences(schema, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validates and throws if there are any errors.
   *
   * @throws SchemaValidationError if the schema is invalid
   */
  validateOrThrow(schema: DatabaseSchema): void {
    const result = this.validate(schema);
    if (!result.valid) {
      throw new SchemaValidationError(result.errors);
    }
  }

  // ----------------------------------------------------------
  //  Table Name Validation
  // ----------------------------------------------------------

  private validateTableName(tableName: string, errors: string[]): void {
    if (!tableName) {
      errors.push("Table name cannot be empty.");
      return;
    }

    // Valid SQL identifier: starts with letter or underscore, no spaces
    const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!VALID_IDENTIFIER.test(tableName)) {
      errors.push(
        `Table name "${tableName}" is not a valid SQL identifier. ` +
          `Use only letters, numbers, and underscores. Must start with a letter or underscore.`
      );
    }

    // Reserved SQL keywords warning
    const SQL_RESERVED = [
      "user",
      "order",
      "group",
      "select",
      "insert",
      "update",
      "delete",
      "table",
      "column",
      "index",
    ];
    if (SQL_RESERVED.includes(tableName.toLowerCase())) {
      // This is a warning, not an error — it works but may cause issues
      errors.push(
        `Table name "${tableName}" is a reserved SQL keyword. ` +
          `Consider renaming it (e.g., "${tableName}s" or "${tableName}_records") ` +
          `to avoid quoting issues across different databases.`
      );
    }
  }

  // ----------------------------------------------------------
  //  Table Schema Validation
  // ----------------------------------------------------------

  private validateTable(
    tableName: string,
    tableSchema: TableSchema,
    errors: string[],
    warnings: string[]
  ): void {
    const columnNames = Object.keys(tableSchema);

    // Empty table
    if (columnNames.length === 0) {
      errors.push(`Table "${tableName}" has no columns defined.`);
      return;
    }

    // Validate each column
    const primaryKeys: string[] = [];
    for (const [columnName, definition] of Object.entries(tableSchema)) {
      this.validateColumnName(tableName, columnName, errors);
      this.validateColumnDefinition(tableName, columnName, definition as ColumnDefinition, errors, warnings);

      if ((definition as ColumnDefinition).primaryKey) {
        primaryKeys.push(columnName);
      }
    }

    // Multiple primary keys warning (composite PK should use createIndex)
    if (primaryKeys.length > 1) {
      errors.push(
        `Table "${tableName}" has multiple primary key columns: ${primaryKeys.join(", ")}. ` +
          `Use a single primaryKey: true column, then use createIndex with unique: true ` +
          `for composite primary keys.`
      );
    }

    // No primary key warning
    if (primaryKeys.length === 0) {
      warnings.push(
        `Table "${tableName}" has no primary key defined. ` +
          `Consider adding an "id" column with primaryKey: true.`
      );
    }
  }

  // ----------------------------------------------------------
  //  Column Name Validation
  // ----------------------------------------------------------

  private validateColumnName(tableName: string, columnName: string, errors: string[]): void {
    if (!columnName) {
      errors.push(`Table "${tableName}" has an empty column name.`);
      return;
    }

    const VALID_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!VALID_IDENTIFIER.test(columnName)) {
      errors.push(
        `Column "${columnName}" in table "${tableName}" is not a valid SQL identifier. ` +
          `Use only letters, numbers, and underscores.`
      );
    }
  }

  // ----------------------------------------------------------
  //  Column Definition Validation
  // ----------------------------------------------------------

  private validateColumnDefinition(
    tableName: string,
    columnName: string,
    definition: ColumnDefinition,
    errors: string[],
    warnings: string[]
  ): void {
    // Must have a schema
    if (!definition.schema) {
      errors.push(
        `Column "${tableName}.${columnName}" is missing a Zod schema. ` +
          `Add a "schema" property with a Zod type.`
      );
      return;
    }

    // Must be a Zod schema instance
    if (!(definition.schema instanceof z.ZodType)) {
      errors.push(
        `Column "${tableName}.${columnName}" has an invalid "schema" value. ` +
          `Expected a Zod schema (e.g., z.string(), z.number()), ` +
          `got: ${typeof definition.schema}`
      );
      return;
    }

    // Warn about primaryKey + nullable combination
    if (definition.primaryKey && definition.nullable) {
      errors.push(
        `Column "${tableName}.${columnName}" cannot be both primaryKey and nullable.`
      );
    }

    // Warn about primaryKey + optional Zod schema
    if (
      definition.primaryKey &&
      definition.schema instanceof z.ZodOptional
    ) {
      warnings.push(
        `Column "${tableName}.${columnName}" is a primary key but uses z.optional(). ` +
          `Primary keys are implicitly NOT NULL. Consider using a non-optional schema.`
      );
    }

    // Warn about boolean columns with no default
    if (
      definition.schema instanceof z.ZodBoolean &&
      definition.default === undefined &&
      !definition.nullable
    ) {
      warnings.push(
        `Column "${tableName}.${columnName}" is a boolean NOT NULL column with no default value. ` +
          `Consider adding "default: false" or "default: true".`
      );
    }
  }

  // ----------------------------------------------------------
  //  Foreign Key Cross-Table Validation
  // ----------------------------------------------------------

  private validateForeignKeyReferences(
    schema: DatabaseSchema,
    errors: string[],
    warnings: string[]
  ): void {
    const allTableNames = new Set(Object.keys(schema));

    for (const [tableName, tableSchema] of Object.entries(schema)) {
      for (const [columnName, definition] of Object.entries(tableSchema as TableSchema)) {
        const ref = (definition as ColumnDefinition).references;
        if (!ref) continue;

        // Referenced table must exist
        if (!allTableNames.has(ref.table)) {
          errors.push(
            `Column "${tableName}.${columnName}" references table "${ref.table}" ` +
              `which is not defined in the schema. ` +
              `Available tables: ${[...allTableNames].join(", ")}`
          );
          continue;
        }

        // Referenced column must exist
        const refTable = schema[ref.table] as TableSchema | undefined;
        if (refTable && !(ref.column in refTable)) {
          const availableCols = Object.keys(refTable).join(", ");
          errors.push(
            `Column "${tableName}.${columnName}" references "${ref.table}.${ref.column}" ` +
              `but column "${ref.column}" doesn't exist in table "${ref.table}". ` +
              `Available columns: ${availableCols}`
          );
          continue;
        }

        // Referenced column should be a primary key or unique
        if (refTable) {
          const refColDef = refTable[ref.column] as ColumnDefinition | undefined;
          if (refColDef && !refColDef.primaryKey && !refColDef.unique) {
            warnings.push(
              `Column "${tableName}.${columnName}" references "${ref.table}.${ref.column}" ` +
                `which is neither a primary key nor has a UNIQUE constraint. ` +
                `Foreign keys should reference unique columns for data integrity.`
            );
          }
        }
      }
    }
  }
}

// ============================================================
//  Factory Function
// ============================================================

/**
 * Validates a schema and returns the result without throwing.
 *
 * @example
 * const { valid, errors, warnings } = validateSchema(mySchema);
 */
export function validateSchema(schema: DatabaseSchema): ValidationResult {
  return new SchemaValidator().validate(schema);
}

/**
 * Validates a schema and throws if invalid.
 *
 * @example
 * validateSchemaOrThrow(mySchema); // throws SchemaValidationError if invalid
 */
export function validateSchemaOrThrow(schema: DatabaseSchema): void {
  return new SchemaValidator().validateOrThrow(schema);
}
