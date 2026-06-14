/**
 * @file file-loader.ts
 * @description Utilities for discovering and loading migration files from disk.
 *
 * Migration files are TypeScript/JavaScript files that follow a naming convention:
 *   {timestamp}_{description}.ts
 *   e.g.: 20241215120000_create_users_table.ts
 *
 * They are discovered by scanning the configured migrations directory,
 * sorted by timestamp, and dynamically imported.
 */

import { readdir, stat } from "fs/promises";
import { join, resolve, extname, basename } from "path";
import type { Migration } from "../types/migration.types.js";

// ============================================================
//  Migration File Pattern
// ============================================================

/**
 * Regex pattern for valid migration file names.
 * Pattern: {14-digit timestamp}_{description}.{ts|js|mjs|cjs}
 * @example "20241215120000_create_users_table.ts"
 */
export const MIGRATION_FILE_PATTERN = /^(\d{14})_([a-z][a-z0-9_]*)\.(?:ts|js|mjs|cjs)$/;

/**
 * Supported migration file extensions (in priority order).
 */
export const MIGRATION_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"] as const;

// ============================================================
//  File Discovery
// ============================================================

export interface MigrationFileInfo {
  /** Absolute path to the migration file */
  path: string;
  /** File name without directory */
  filename: string;
  /** Extracted timestamp as number */
  timestamp: number;
  /** Extracted description part */
  description: string;
  /** Full migration name (timestamp_description) */
  name: string;
}

/**
 * Scans a directory and returns all valid migration file infos,
 * sorted by timestamp (ascending — oldest first).
 *
 * @param migrationsDir - Absolute or relative path to the migrations directory
 * @returns Sorted array of migration file metadata
 *
 * @throws If the directory doesn't exist or can't be read
 */
export async function discoverMigrationFiles(
  migrationsDir: string
): Promise<MigrationFileInfo[]> {
  const absoluteDir = resolve(migrationsDir);

  // Verify directory exists
  try {
    const stats = await stat(absoluteDir);
    if (!stats.isDirectory()) {
      throw new Error(
        `[db-migrate-ts] Migrations path is not a directory: ${absoluteDir}`
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `[db-migrate-ts] Migrations directory not found: ${absoluteDir}\n` +
          `Run "db-migrate-ts generate <name>" to create your first migration.`
      );
    }
    throw err;
  }

  const entries = await readdir(absoluteDir);
  const migrationFiles: MigrationFileInfo[] = [];

  for (const filename of entries) {
    const ext = extname(filename);
    if (!MIGRATION_EXTENSIONS.includes(ext as (typeof MIGRATION_EXTENSIONS)[number])) {
      continue;
    }

    // Skip meta directory (used by wrangler D1)
    if (filename === "meta") continue;

    // Skip snapshot files
    if (filename.endsWith(".snapshot.sql")) continue;

    const match = MIGRATION_FILE_PATTERN.exec(filename);
    if (!match) {
      // Skip non-matching files silently (e.g. helpers, seeds)
      continue;
    }

    const [, timestampStr, description] = match as unknown as [string, string, string];
    const timestamp = parseInt(timestampStr, 10);
    const name = `${timestampStr}_${description}`;

    migrationFiles.push({
      path: join(absoluteDir, filename),
      filename,
      timestamp,
      description,
      name,
    });
  }

  // Sort by timestamp ascending (oldest migration runs first)
  return migrationFiles.sort((a, b) => a.timestamp - b.timestamp);
}

// ============================================================
//  Dynamic Module Loading
// ============================================================

/**
 * Dynamically imports a migration file and returns its Migration object.
 *
 * Supports both default exports and named exports.
 *
 * @param filePath - Absolute path to the migration file
 * @returns The Migration object
 *
 * @throws If the file can't be imported or doesn't export a valid Migration
 */
export async function loadMigrationFile(filePath: string): Promise<Migration> {
  let module: unknown;

  try {
    // Use dynamic import — works with both ESM and CommonJS
    module = await import(/* @vite-ignore */ filePath);
  } catch (err) {
    throw new Error(
      `[db-migrate-ts] Failed to import migration file: ${filePath}\n` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Handle both default export and named export
  const migration =
    (module as { default?: Migration }).default ??
    (module as { migration?: Migration }).migration ??
    module;

  // Validate the migration object
  validateMigrationShape(migration, filePath);

  return migration as Migration;
}

/**
 * Loads all migration files from a directory.
 *
 * @param migrationsDir - Path to the migrations directory
 * @returns Sorted array of loaded Migration objects
 */
export async function loadAllMigrations(migrationsDir: string): Promise<Migration[]> {
  const files = await discoverMigrationFiles(migrationsDir);
  const migrations: Migration[] = [];

  for (const fileInfo of files) {
    const migration = await loadMigrationFile(fileInfo.path);

    // Override name from file if not set in the migration object
    if (!migration.name) {
      (migration as Migration).name = fileInfo.name;
    }
    if (!migration.timestamp) {
      (migration as Migration).timestamp = fileInfo.timestamp;
    }

    migrations.push(migration);
  }

  return migrations;
}

// ============================================================
//  Validation
// ============================================================

/**
 * Validates that a loaded module exports a valid Migration object.
 *
 * @throws Descriptive error if the migration is malformed
 */
function validateMigrationShape(migration: unknown, filePath: string): void {
  const filename = basename(filePath);

  if (!migration || typeof migration !== "object") {
    throw new Error(
      `[db-migrate-ts] Invalid migration export in "${filename}": ` +
        `Expected an object, got ${typeof migration}. ` +
        `Make sure to export a Migration object (default export or named "migration" export).`
    );
  }

  const m = migration as Record<string, unknown>;

  if (typeof m["up"] !== "function") {
    throw new Error(
      `[db-migrate-ts] Invalid migration "${filename}": ` +
        `Missing or invalid "up" function. Expected a function, got ${typeof m["up"]}.`
    );
  }

  if (typeof m["down"] !== "function") {
    throw new Error(
      `[db-migrate-ts] Invalid migration "${filename}": ` +
        `Missing or invalid "down" function. Expected a function, got ${typeof m["down"]}.`
    );
  }
}

// ============================================================
//  Timestamp Generation
// ============================================================

/**
 * Generates a 14-digit timestamp string in the format YYYYMMDDHHMMSS.
 * Used for naming new migration files.
 *
 * @returns "20241215143025" (example)
 */
export function generateTimestamp(): string {
  const now = new Date();
  const pad = (n: number, len = 2): string => String(n).padStart(len, "0");

  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

/**
 * Converts a migration name string to a valid snake_case file-safe name.
 *
 * @example
 * sanitizeMigrationName("Create Users Table")  // → "create_users_table"
 * sanitizeMigrationName("add-email-column")     // → "add_email_column"
 * sanitizeMigrationName("  Add INDEX  ")        // → "add_index"
 */
export function sanitizeMigrationName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}
