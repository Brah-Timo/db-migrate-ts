/**
 * @file hash.ts
 * @description Hashing utilities for migration checksums and integrity verification.
 *
 * Each migration file gets a SHA-256 checksum computed from the string
 * representation of its `up` and `down` functions. This checksum is stored
 * in the migrations history table. Before re-executing a migration, the
 * runner verifies the checksum hasn't changed — protecting against
 * accidentally editing already-executed migrations.
 */

import { createHash } from "crypto";

/**
 * Computes a short hex checksum (16 chars) for a migration.
 *
 * @param content - String content to hash (typically up.toString() + down.toString())
 * @returns 16-character hex string
 *
 * @example
 * const checksum = computeChecksum(migration.up.toString() + migration.down.toString());
 * // → "a4f8c2d1e9b0f3a7"
 */
export function computeChecksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/**
 * Computes a full 64-character SHA-256 hex hash.
 *
 * @param content - String content to hash
 * @returns 64-character hex string
 */
export function computeFullHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Computes a checksum specifically for a migration object.
 * Includes both up and down function source code.
 *
 * @param migration - Object with up and down function fields
 * @returns 16-character hex checksum
 */
export function computeMigrationChecksum(migration: {
  up: (arg: unknown) => unknown;
  down: (arg: unknown) => unknown;
}): string {
  const content = migration.up.toString() + "||" + migration.down.toString();
  return computeChecksum(content);
}

/**
 * Computes a deterministic hash for a file path + timestamp combination.
 * Used for generating unique index names.
 *
 * @param tableName  - Table name
 * @param columns    - Column names included in the index
 * @returns Short 8-character hash suffix
 */
export function computeIndexNameHash(tableName: string, columns: string[]): string {
  const content = tableName + ":" + columns.sort().join(",");
  return createHash("md5").update(content).digest("hex").slice(0, 8);
}

/**
 * Validates that a given checksum matches the expected value.
 *
 * @param content          - The content to verify
 * @param expectedChecksum - The stored checksum to compare against
 * @returns true if valid, false if tampered
 */
export function validateChecksum(content: string, expectedChecksum: string): boolean {
  const computed = computeChecksum(content);
  // Use timing-safe comparison to prevent timing attacks
  if (computed.length !== expectedChecksum.length) return false;

  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ expectedChecksum.charCodeAt(i);
  }
  return result === 0;
}
