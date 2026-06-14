/**
 * @file status.command.ts
 * @description CLI command: `db-migrate-ts status`
 *
 * Displays a table showing the status of all migrations:
 *   ✅ executed | ⏳ pending | ⚠️ checksum mismatch | 👻 orphaned
 */

import chalk from "chalk";
import type { OptionValues } from "commander";
import { loadConfig } from "../config-loader.js";
import { loadAllMigrations } from "db-migrate-ts/src/utils/file-loader";
import { MigrationRunner } from "db-migrate-ts";

export interface StatusOptions extends OptionValues {
  config: string;
  json: boolean;
}

/**
 * Handles the `db-migrate-ts status` command.
 */
export async function statusCommand(options: StatusOptions): Promise<void> {
  if (!options.json) {
    console.log(chalk.cyan.bold("\n⚡ db-migrate-ts") + chalk.gray(" — migration status\n"));
  }

  // Load config
  let config;
  try {
    config = await loadConfig(options.config);
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ error: (error as Error).message }));
    } else {
      console.error(chalk.red(`❌ ${(error as Error).message}`));
    }
    process.exit(1);
  }

  // Load migration files
  let migrations;
  try {
    migrations = await loadAllMigrations(config.migrationsDir);
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ error: (error as Error).message }));
    } else {
      console.error(chalk.red(`❌ ${(error as Error).message}`));
    }
    process.exit(1);
  }

  // Get status from runner
  const runner = new MigrationRunner(config.connection, { dialect: config.adapter });

  let statusEntries;
  try {
    statusEntries = await runner.status(migrations);
  } catch (error) {
    console.error(chalk.red(`❌ ${(error as Error).message}`));
    process.exit(1);
  } finally {
    await config.connection.close();
  }

  // JSON output mode
  if (options.json) {
    console.log(JSON.stringify(statusEntries, null, 2));
    return;
  }

  // Table output
  const pendingCount = statusEntries.filter((e) => e.status === "pending").length;
  const executedCount = statusEntries.filter((e) => e.status === "executed").length;
  const invalidCount = statusEntries.filter(
    (e) => e.status === "executed" && e.checksumValid === false
  ).length;

  // Print summary line
  console.log(
    chalk.gray(`  Database: ${config.adapter.toUpperCase()}`) +
    chalk.gray(` | Migrations dir: ${config.migrationsDir}`)
  );
  console.log(
    chalk.green(`  ✅ ${executedCount} executed`) +
    chalk.gray(` | `) +
    chalk.yellow(`  ⏳ ${pendingCount} pending`) +
    (invalidCount > 0 ? chalk.gray(` | `) + chalk.red(`  ⚠️  ${invalidCount} modified`) : "")
  );
  console.log();

  if (statusEntries.length === 0) {
    console.log(chalk.gray("  No migrations found."));
    return;
  }

  // Column widths
  const nameWidth = Math.max(
    "Migration".length,
    ...statusEntries.map((e) => e.name.length)
  );

  // Header
  const header =
    " " +
    chalk.bold.white("Migration".padEnd(nameWidth)) +
    "  " +
    chalk.bold.white("Status".padEnd(12)) +
    "  " +
    chalk.bold.white("Applied At".padEnd(20)) +
    "  " +
    chalk.bold.white("Duration");

  console.log(header);
  console.log(chalk.gray("─".repeat(nameWidth + 50)));

  // Rows
  for (const entry of statusEntries) {
    const name = entry.name.padEnd(nameWidth);
    let statusStr: string;
    let appliedAt = "";
    let duration = "";

    switch (entry.status) {
      case "executed":
        if (entry.checksumValid === false) {
          statusStr = chalk.red("⚠️  MODIFIED".padEnd(12));
        } else {
          statusStr = chalk.green("✅ executed".padEnd(12));
        }
        appliedAt = entry.executedAt
          ? chalk.gray(entry.executedAt.toISOString().replace("T", " ").slice(0, 19))
          : "";
        duration = entry.durationMs ? chalk.gray(`${entry.durationMs}ms`) : "";
        break;

      case "pending":
        statusStr = chalk.yellow("⏳ pending".padEnd(12));
        break;

      case "skipped":
        statusStr = chalk.gray("👻 orphaned".padEnd(12));
        break;

      case "failed":
        statusStr = chalk.red("❌ failed".padEnd(12));
        break;

      default:
        statusStr = entry.status;
    }

    console.log(` ${name}  ${statusStr}  ${appliedAt.padEnd(20)}  ${duration}`);
  }

  console.log();

  // Warning for modified migrations
  if (invalidCount > 0) {
    console.log(
      chalk.red.bold(
        `  ⚠️  WARNING: ${invalidCount} migration(s) have been modified after execution!\n` +
          `  This may cause data integrity issues. ` +
          `Never edit a migration that has been applied to any database.`
      )
    );
    console.log();
  }
}
