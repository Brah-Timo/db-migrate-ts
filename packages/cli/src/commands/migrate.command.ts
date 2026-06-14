/**
 * @file migrate.command.ts
 * @description CLI command: `db-migrate-ts up`
 *
 * Runs all pending migrations in ascending timestamp order.
 * Each migration is wrapped in a database transaction.
 */

import chalk from "chalk";
import ora from "ora";
import type { OptionValues } from "commander";
import { loadConfig } from "../config-loader.js";
import { loadAllMigrations } from "db-migrate-ts/src/utils/file-loader";
import { MigrationRunner } from "db-migrate-ts";

export interface MigrateOptions extends OptionValues {
  config: string;
  dryRun: boolean;
  limit?: string;
}

/**
 * Handles the `db-migrate-ts up` command.
 */
export async function migrateCommand(options: MigrateOptions): Promise<void> {
  console.log(chalk.cyan.bold("\n⚡ db-migrate-ts") + chalk.gray(" — running migrations\n"));

  const spinner = ora("Loading configuration...").start();

  let config;
  try {
    config = await loadConfig(options.config);
    spinner.succeed(chalk.green("Configuration loaded"));
  } catch (error) {
    spinner.fail(chalk.red("Failed to load configuration"));
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }

  // Load migration files
  let migrations;
  try {
    migrations = await loadAllMigrations(config.migrationsDir);
    console.log(
      chalk.gray(`  📁 Migrations directory: ${config.migrationsDir}`) +
      chalk.cyan(` (${migrations.length} file${migrations.length === 1 ? "" : "s"} found)`)
    );
  } catch (error) {
    console.error(chalk.red(`\n❌ ${(error as Error).message}`));
    process.exit(1);
  }

  if (migrations.length === 0) {
    console.log(chalk.yellow("\n⚠️  No migration files found in the migrations directory."));
    console.log(
      chalk.gray('  Create your first migration with: db-migrate-ts generate <name>\n')
    );
    process.exit(0);
  }

  // Create runner
  const runner = new MigrationRunner(config.connection, {
    dialect: config.adapter,
    dryRun: options.dryRun,
    ...config.options,
  });

  if (options.dryRun) {
    console.log(chalk.yellow.bold("\n  🔍 DRY RUN MODE — no changes will be made to the database\n"));
  }

  // Run migrations
  try {
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;
    const result = await runner.up(migrations, limit);

    if (result.applied.length > 0) {
      console.log(
        chalk.green.bold(
          `\n✅ Successfully applied ${result.applied.length} migration${
            result.applied.length === 1 ? "" : "s"
          }${options.dryRun ? " (dry run)" : ""}.`
        )
      );
    }
  } catch (error) {
    console.error(chalk.red(`\n❌ Migration failed:\n  ${(error as Error).message}`));
    if ((error as Error).stack && process.env.DEBUG) {
      console.error(chalk.gray((error as Error).stack));
    }
    process.exit(1);
  } finally {
    await config.connection.close();
  }

  console.log(); // Final newline
}
