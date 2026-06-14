/**
 * @file validate.command.ts
 * @description CLI command: `db-migrate-ts validate`
 *
 * Validates migration files without executing them:
 *   1. Checks all migration files can be loaded (valid syntax)
 *   2. Checks for duplicate timestamps
 *   3. Checks for duplicate names
 *   4. Validates the schema definition (if provided)
 *   5. Dry-runs each migration to verify SQL generation
 *   6. Checks down() mirrors up() (warns if down is empty)
 */

import chalk from "chalk";
import type { OptionValues } from "commander";
import { loadConfig } from "../config-loader.js";
import { loadAllMigrations, discoverMigrationFiles } from "db-migrate-ts/src/utils/file-loader";
import { MigrationBuilderImpl } from "db-migrate-ts";
import { SqlBuilder } from "db-migrate-ts/src/sql/sql-builder";
import { validateSchema } from "db-migrate-ts/src/schema/schema-validator";

export interface ValidateOptions extends OptionValues {
  config: string;
  sql: boolean;
}

/**
 * Handles the `db-migrate-ts validate` command.
 */
export async function validateCommand(options: ValidateOptions): Promise<void> {
  console.log(chalk.cyan.bold("\n⚡ db-migrate-ts") + chalk.gray(" — validating migrations\n"));

  // Load config
  let config;
  try {
    config = await loadConfig(options.config);
  } catch (error) {
    console.error(chalk.red(`❌ ${(error as Error).message}`));
    process.exit(1);
  }

  let hasErrors = false;
  let warningCount = 0;

  // ── 1. Discover files ──────────────────────────────────────
  console.log(chalk.gray(`  📁 Scanning: ${config.migrationsDir}`));
  let files;
  try {
    files = await discoverMigrationFiles(config.migrationsDir);
    console.log(chalk.gray(`  Found ${files.length} migration file(s)\n`));
  } catch (error) {
    console.error(chalk.red(`  ❌ ${(error as Error).message}`));
    process.exit(1);
  }

  // ── 2. Load all migration files ───────────────────────────
  console.log(chalk.bold("  Checking file syntax..."));
  let migrations;
  try {
    migrations = await loadAllMigrations(config.migrationsDir);
    console.log(chalk.green(`  ✅ All ${migrations.length} files loaded successfully`));
  } catch (error) {
    console.error(chalk.red(`  ❌ ${(error as Error).message}`));
    hasErrors = true;
    migrations = [];
  }

  // ── 3. Check for duplicate timestamps ─────────────────────
  console.log(chalk.bold("\n  Checking for duplicate timestamps..."));
  const timestampMap = new Map<number, string[]>();
  for (const m of migrations) {
    const existing = timestampMap.get(m.timestamp) ?? [];
    existing.push(m.name);
    timestampMap.set(m.timestamp, existing);
  }

  let duplicateTimestamps = 0;
  for (const [ts, names] of timestampMap.entries()) {
    if (names.length > 1) {
      console.error(
        chalk.red(`  ❌ Duplicate timestamp ${ts}: `) + chalk.white(names.join(", "))
      );
      hasErrors = true;
      duplicateTimestamps++;
    }
  }
  if (duplicateTimestamps === 0) {
    console.log(chalk.green("  ✅ No duplicate timestamps"));
  }

  // ── 4. Check for duplicate names ──────────────────────────
  console.log(chalk.bold("\n  Checking for duplicate names..."));
  const nameSet = new Set<string>();
  const duplicateNames: string[] = [];
  for (const m of migrations) {
    if (nameSet.has(m.name)) {
      duplicateNames.push(m.name);
    } else {
      nameSet.add(m.name);
    }
  }

  if (duplicateNames.length > 0) {
    console.error(chalk.red(`  ❌ Duplicate migration names: ${duplicateNames.join(", ")}`));
    hasErrors = true;
  } else {
    console.log(chalk.green("  ✅ All migration names are unique"));
  }

  // ── 5. Validate schema definition ─────────────────────────
  if (config.schema) {
    console.log(chalk.bold("\n  Validating schema definition..."));
    const result = validateSchema(config.schema);

    if (!result.valid) {
      result.errors.forEach((e) => console.error(chalk.red(`  ❌ ${e}`)));
      hasErrors = true;
    } else {
      const tableCount = Object.keys(config.schema).length;
      console.log(chalk.green(`  ✅ Schema valid (${tableCount} tables)`));
    }

    if (result.warnings.length > 0) {
      result.warnings.forEach((w) => {
        console.warn(chalk.yellow(`  ⚠️  ${w}`));
        warningCount++;
      });
    }
  }

  // ── 6. Dry-run SQL generation ──────────────────────────────
  console.log(chalk.bold("\n  Testing SQL generation for each migration..."));
  const sqlBuilder = new SqlBuilder(config.adapter);

  for (const migration of migrations) {
    // Test up()
    const upBuilder = new MigrationBuilderImpl(config.adapter);
    try {
      await migration.up(upBuilder);
      const upSQL = sqlBuilder.compile(upBuilder.getOperations());

      if (upBuilder.isEmpty()) {
        console.warn(chalk.yellow(`  ⚠️  "${migration.name}": up() generates no operations`));
        warningCount++;
      } else {
        if (options.sql) {
          console.log(chalk.gray(`  → ${migration.name} (up):`));
          upSQL.forEach((s) => console.log(chalk.gray(`      ${s}`)));
        }
      }
    } catch (error) {
      console.error(
        chalk.red(`  ❌ "${migration.name}" up() error: ${(error as Error).message}`)
      );
      hasErrors = true;
    }

    // Test down()
    const downBuilder = new MigrationBuilderImpl(config.adapter);
    try {
      await migration.down(downBuilder);
      if (downBuilder.isEmpty()) {
        console.warn(
          chalk.yellow(
            `  ⚠️  "${migration.name}": down() is empty — rollback won't do anything`
          )
        );
        warningCount++;
      }
    } catch (error) {
      console.error(
        chalk.red(`  ❌ "${migration.name}" down() error: ${(error as Error).message}`)
      );
      hasErrors = true;
    }
  }

  if (!hasErrors && migrations.length > 0) {
    console.log(chalk.green(`  ✅ All ${migrations.length} migrations passed SQL generation`));
  }

  // ── Summary ────────────────────────────────────────────────
  console.log();
  console.log(chalk.bold.white("  ── Validation Summary ──────────────────────"));
  console.log(`  Files scanned:   ${migrations.length}`);
  console.log(
    `  Result:          ${
      hasErrors
        ? chalk.red("❌ FAILED")
        : chalk.green("✅ PASSED")
    }`
  );
  if (warningCount > 0) {
    console.log(`  Warnings:        ${chalk.yellow(warningCount)}`);
  }
  console.log();

  await config.connection.close();

  if (hasErrors) {
    process.exit(1);
  }
}
