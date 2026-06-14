/**
 * @file rollback.command.ts
 * @description CLI command: `db-migrate-ts down`
 *
 * Rolls back the last N executed migrations.
 * With --to flag, rolls back to a specific migration.
 */

import chalk from "chalk";
import prompts from "prompts";
import type { OptionValues } from "commander";
import { loadConfig } from "../config-loader.js";
import { loadAllMigrations } from "db-migrate-ts/src/utils/file-loader";
import { MigrationRunner, RollbackManager } from "db-migrate-ts";

export interface RollbackOptions extends OptionValues {
  config: string;
  steps: string;
  to?: string;
  all: boolean;
  yes: boolean;
  dryRun: boolean;
}

/**
 * Handles the `db-migrate-ts down` command.
 */
export async function rollbackCommand(options: RollbackOptions): Promise<void> {
  console.log(chalk.yellow.bold("\n⚡ db-migrate-ts") + chalk.gray(" — rolling back\n"));

  // Load config
  let config;
  try {
    config = await loadConfig(options.config);
  } catch (error) {
    console.error(chalk.red(`❌ ${(error as Error).message}`));
    process.exit(1);
  }

  // Load migration files
  let migrations;
  try {
    migrations = await loadAllMigrations(config.migrationsDir);
  } catch (error) {
    console.error(chalk.red(`❌ ${(error as Error).message}`));
    process.exit(1);
  }

  const steps = parseInt(options.steps, 10);
  const isProduction = process.env.NODE_ENV === "production";

  // Safety confirmation for production
  if (isProduction && !options.yes) {
    console.log(chalk.red.bold("  ⚠️  WARNING: You are about to rollback on PRODUCTION!"));
    const { confirmed } = await prompts({
      type: "confirm",
      name: "confirmed",
      message: "Are you sure you want to rollback on production?",
      initial: false,
    });

    if (!confirmed) {
      console.log(chalk.gray("  Rollback cancelled."));
      process.exit(0);
    }
  }

  const runner = new MigrationRunner(config.connection, {
    dialect: config.adapter,
    dryRun: options.dryRun,
    ...config.options,
  });

  const rollbackManager = new RollbackManager(
    config.connection,
    migrations,
    config.adapter
  );

  if (options.dryRun) {
    console.log(chalk.yellow.bold("  🔍 DRY RUN MODE — no changes will be made\n"));
  }

  try {
    if (options.all) {
      // Rollback everything
      console.log(chalk.red("  ⚠️  Rolling back ALL migrations..."));
      const rolled = await rollbackManager.rollbackAll();
      console.log(chalk.green(`\n✅ Rolled back ${rolled.length} migration(s).`));
    } else if (options.to) {
      // Rollback to specific migration
      console.log(chalk.yellow(`  Rolling back to: "${options.to}"...`));
      const rolled = await rollbackManager.rollbackTo(options.to);
      console.log(chalk.green(`\n✅ Rolled back ${rolled.length} migration(s).`));
    } else {
      // Rollback N steps
      console.log(
        chalk.yellow(`  Rolling back ${steps} migration${steps === 1 ? "" : "s"}...`)
      );
      const result = await runner.down(migrations, steps);
      console.log(chalk.green(`\n✅ Rolled back ${result.rolledBack.length} migration(s).`));
    }
  } catch (error) {
    console.error(chalk.red(`\n❌ Rollback failed: ${(error as Error).message}`));
    process.exit(1);
  } finally {
    await config.connection.close();
  }

  console.log();
}
