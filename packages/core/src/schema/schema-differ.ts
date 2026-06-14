/**
 * @file schema-differ.ts
 * @description Computes the structural diff between two database schemas.
 *
 * The SchemaDiffer compares an "old" schema (e.g. the last committed schema)
 * against a "new" schema (the current schema definition) and produces a list
 * of SchemaChange objects describing every structural difference.
 *
 * This is the foundation for auto-generating migration files — instead of
 * writing migrations by hand, the differ can detect what changed and the
 * generator can turn those changes into a migration file.
 */

import type { DatabaseSchema, TableSchema, SchemaDiff, SchemaChange } from "../types/table.types.js";
import type { ColumnDefinition } from "../types/column.types.js";

// ============================================================
//  Schema Differ
// ============================================================

/**
 * Computes a structural diff between two DatabaseSchema objects.
 *
 * @example
 * const differ = new SchemaDiffer();
 *
 * const diff = differ.diff(oldSchema, newSchema);
 * if (diff.hasChanges) {
 *   console.log(`Found ${diff.changes.length} change(s):`);
 *   diff.changes.forEach(change => console.log(change.kind, change));
 * }
 */
export class SchemaDiffer {
  /**
   * Computes the diff between two schemas.
   *
   * @param oldSchema - The previous schema version
   * @param newSchema - The current (new) schema version
   * @returns A SchemaDiff describing all detected changes
   */
  diff(oldSchema: DatabaseSchema, newSchema: DatabaseSchema): SchemaDiff {
    const changes: SchemaChange[] = [];

    const oldTables = new Set(Object.keys(oldSchema));
    const newTables = new Set(Object.keys(newSchema));

    const addedTables: string[] = [];
    const removedTables: string[] = [];
    const modifiedTables: string[] = [];

    // --- Detect ADDED tables ---
    for (const tableName of newTables) {
      if (!oldTables.has(tableName)) {
        addedTables.push(tableName);
        changes.push({
          kind: "CREATE_TABLE",
          tableName,
          schema: newSchema[tableName] as TableSchema,
        });
      }
    }

    // --- Detect REMOVED tables ---
    for (const tableName of oldTables) {
      if (!newTables.has(tableName)) {
        removedTables.push(tableName);
        changes.push({ kind: "DROP_TABLE", tableName });
      }
    }

    // --- Detect MODIFIED tables (columns changed) ---
    for (const tableName of oldTables) {
      if (!newTables.has(tableName)) continue; // Already handled as DROP

      const oldTable = oldSchema[tableName] as TableSchema;
      const newTable = newSchema[tableName] as TableSchema;

      const columnChanges = this.diffTableColumns(tableName, oldTable, newTable);
      if (columnChanges.length > 0) {
        modifiedTables.push(tableName);
        changes.push(...columnChanges);
      }
    }

    return {
      changes,
      addedTables,
      removedTables,
      modifiedTables,
      hasChanges: changes.length > 0,
    };
  }

  // ----------------------------------------------------------
  //  Column-Level Diffing
  // ----------------------------------------------------------

  /**
   * Compares the columns of one table version against another.
   */
  private diffTableColumns(
    tableName: string,
    oldTable: TableSchema,
    newTable: TableSchema
  ): SchemaChange[] {
    const changes: SchemaChange[] = [];

    const oldCols = new Set(Object.keys(oldTable));
    const newCols = new Set(Object.keys(newTable));

    // --- Added columns ---
    for (const colName of newCols) {
      if (!oldCols.has(colName)) {
        changes.push({
          kind: "ADD_COLUMN",
          tableName,
          columnName: colName,
          definition: newTable[colName] as ColumnDefinition,
        });
      }
    }

    // --- Dropped columns ---
    for (const colName of oldCols) {
      if (!newCols.has(colName)) {
        changes.push({
          kind: "DROP_COLUMN",
          tableName,
          columnName: colName,
        });
      }
    }

    // --- Modified columns ---
    for (const colName of oldCols) {
      if (!newCols.has(colName)) continue; // Already handled as DROP

      const oldDef = oldTable[colName] as ColumnDefinition;
      const newDef = newTable[colName] as ColumnDefinition;

      if (this.columnChanged(oldDef, newDef)) {
        changes.push({
          kind: "ALTER_COLUMN",
          tableName,
          columnName: colName,
          before: oldDef,
          after: newDef,
        });
      }
    }

    return changes;
  }

  // ----------------------------------------------------------
  //  Column Change Detection
  // ----------------------------------------------------------

  /**
   * Determines whether two ColumnDefinitions are structurally different.
   *
   * Compares the serialized representation of both definitions.
   * Note: Function references (in Zod schemas) are compared by string representation.
   */
  private columnChanged(oldDef: ColumnDefinition, newDef: ColumnDefinition): boolean {
    return this.serializeColumn(oldDef) !== this.serializeColumn(newDef);
  }

  /**
   * Serializes a ColumnDefinition to a stable string for comparison.
   * Uses schema.toString() for Zod schemas (captures the definition structure).
   */
  private serializeColumn(def: ColumnDefinition): string {
    return JSON.stringify({
      schema: def.schema.toString(),
      nullable: def.nullable,
      primaryKey: def.primaryKey,
      unique: def.unique,
      default: def.default,
      references: def.references
        ? {
            table: def.references.table,
            column: def.references.column,
            onDelete: def.references.onDelete,
            onUpdate: def.references.onUpdate,
          }
        : undefined,
    });
  }
}

// ============================================================
//  Diff Formatter — human-readable output
// ============================================================

/**
 * Formats a SchemaDiff into a human-readable string for display in the CLI.
 *
 * @example
 * const diff = differ.diff(oldSchema, newSchema);
 * console.log(formatDiff(diff));
 */
export function formatDiff(diff: SchemaDiff): string {
  if (!diff.hasChanges) {
    return "✓ No schema changes detected.";
  }

  const lines: string[] = [
    `Found ${diff.changes.length} schema change(s):`,
    "",
  ];

  for (const change of diff.changes) {
    switch (change.kind) {
      case "CREATE_TABLE":
        lines.push(
          `  + CREATE TABLE "${change.tableName}" ` +
            `(${Object.keys(change.schema).length} columns)`
        );
        break;

      case "DROP_TABLE":
        lines.push(`  - DROP TABLE "${change.tableName}"`);
        break;

      case "RENAME_TABLE":
        lines.push(`  ~ RENAME TABLE "${change.from}" → "${change.to}"`);
        break;

      case "ADD_COLUMN":
        lines.push(`  + ADD COLUMN "${change.tableName}"."${change.columnName}"`);
        break;

      case "DROP_COLUMN":
        lines.push(`  - DROP COLUMN "${change.tableName}"."${change.columnName}"`);
        break;

      case "RENAME_COLUMN":
        lines.push(
          `  ~ RENAME COLUMN "${change.tableName}"."${change.from}" → "${change.to}"`
        );
        break;

      case "ALTER_COLUMN":
        lines.push(`  ~ ALTER COLUMN "${change.tableName}"."${change.columnName}"`);
        break;

      case "ADD_INDEX":
        lines.push(
          `  + ADD INDEX "${change.index.name}" ON "${change.tableName}" ` +
            `(${change.index.columns.join(", ")})`
        );
        break;

      case "DROP_INDEX":
        lines.push(`  - DROP INDEX "${change.indexName}"`);
        break;
    }
  }

  return lines.join("\n");
}
