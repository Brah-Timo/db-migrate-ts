/**
 * @file cli.ts
 * @description Main CLI entry point for db-migrate-ts.
 *
 * Commands:
 *   up       — Run all pending migrations
 *   down     — Roll back migration(s)
 *   status   — Show migration status table
 *   generate — Create a new migration file
 *   validate — Validate migration files without executing
 *
 * Usage:
 *   db-migrate-ts up
 *   db-migrate-ts up --dry-run
 *   db-migrate-ts down --steps 2
 *   db-migrate-ts down --to 20241215120000_create_users
 *   db-migrate-ts status
 *   db-migrate-ts status --json
 *   db-migrate-ts generate create_users_table --template table
 *   db-migrate-ts validate
 */

import { Command } from "commander";
import chalk from "chalk";
import { migrateCommand } from "./commands/migrate.command.js";
import { rollbackCommand } from "./commands/rollback.command.js";
import { statusCommand } from "./commands/status.command.js";
import { generateCommand } from "./commands/generate.command.js";
import { validateCommand } from "./commands/validate.command.js";

// ============================================================
//  Version & Package Info
// ============================================================

const VERSION = "1.0.0";

const BANNER = `
${chalk.cyan.bold("  ██████╗ ██████╗       ███╗   ███╗██╗ ██████╗ ██████╗  █████╗ ████████╗███████╗")}
${chalk.cyan("  ██╔══██╗██╔══██╗      ████╗ ████║██║██╔════╝ ██╔══██╗██╔══██╗╚══██╔══╝██╔════╝")}
${chalk.cyan("  ██║  ██║██████╔╝█████╗██╔████╔██║██║██║  ███╗██████╔╝███████║   ██║   █████╗  ")}
${chalk.cyan("  ██║  ██║██╔══██╗╚════╝██║╚██╔╝██║██║██║   ██║██╔══██╗██╔══██║   ██║   ██╔══╝  ")}
${chalk.cyan("  ██████╔╝██████╔╝      ██║ ╚═╝ ██║██║╚██████╔╝██║  ██║██║  ██║   ██║   ███████╗")}
${chalk.cyan("  ╚═════╝ ╚═════╝       ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝")}
${chalk.gray(`                       Type-safe DB migrations powered by Zod — v${VERSION}`)}
`;

// ============================================================
//  CLI Program
// ============================================================

const program = new Command();

program
  .name("db-migrate-ts")
  .description(
    chalk.cyan("⚡ Type-safe database migrations powered by Zod and TypeScript")
  )
  .version(VERSION, "-v, --version", "Output the current version")
  .addHelpText("beforeAll", BANNER);

// ----------------------------------------------------------
//  Global options (shared across all commands)
// ----------------------------------------------------------

const CONFIG_OPTION = [
  "-c, --config <path>",
  'Path to config file or directory',
  "./db-migrate.config.ts",
] as const;

// ----------------------------------------------------------
//  up — Run pending migrations
// ----------------------------------------------------------

program
  .command("up")
  .description("Run all pending migrations (oldest first)")
  .option(...CONFIG_OPTION)
  .option("--dry-run", "Preview SQL without executing anything", false)
  .option(
    "-l, --limit <number>",
    "Run at most N pending migrations",
    undefined
  )
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  ${chalk.cyan("$ db-migrate-ts up")}                          Run all pending migrations
  ${chalk.cyan("$ db-migrate-ts up --dry-run")}               Preview SQL without executing
  ${chalk.cyan("$ db-migrate-ts up --limit 3")}               Run at most 3 pending migrations
  ${chalk.cyan("$ db-migrate-ts up --config ./custom.config.ts")}  Use custom config
`
  )
  .action(migrateCommand);

// ----------------------------------------------------------
//  down — Rollback migrations
// ----------------------------------------------------------

program
  .command("down")
  .description("Roll back the last migration(s)")
  .option(...CONFIG_OPTION)
  .option("-s, --steps <number>", "Number of migrations to roll back", "1")
  .option("--to <name>", "Roll back to (but not including) this migration")
  .option("--all", "Roll back ALL migrations (complete reset)", false)
  .option("-y, --yes", "Skip confirmation prompts", false)
  .option("--dry-run", "Preview SQL without executing anything", false)
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  ${chalk.cyan("$ db-migrate-ts down")}                        Roll back the last 1 migration
  ${chalk.cyan("$ db-migrate-ts down --steps 3")}              Roll back the last 3 migrations
  ${chalk.cyan("$ db-migrate-ts down --to 20241215120000_create_users")}  Roll back to specific
  ${chalk.cyan("$ db-migrate-ts down --all")}                  Roll back EVERYTHING (⚠️ dangerous)
  ${chalk.cyan("$ db-migrate-ts down --dry-run")}              Preview without executing
`
  )
  .action(rollbackCommand);

// ----------------------------------------------------------
//  status — Show migration status
// ----------------------------------------------------------

program
  .command("status")
  .description("Show the current migration status (executed / pending)")
  .option(...CONFIG_OPTION)
  .option("--json", "Output status as JSON (for CI/CD integration)", false)
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  ${chalk.cyan("$ db-migrate-ts status")}                      Show status table
  ${chalk.cyan("$ db-migrate-ts status --json")}               Output as JSON
  ${chalk.cyan("$ db-migrate-ts status --json | jq '.[] | select(.status == \"pending\")'}")}
`
  )
  .action(statusCommand);

// ----------------------------------------------------------
//  generate — Create a new migration file
// ----------------------------------------------------------

program
  .command("generate <name>")
  .description("Generate a new migration file with the correct timestamp prefix")
  .option(...CONFIG_OPTION)
  .option("-d, --dir <path>", "Target directory for the new file (overrides config)")
  .option(
    "--template <type>",
    "Template: blank | table | column",
    "blank"
  )
  .addHelpText(
    "after",
    `
${chalk.bold("Examples:")}
  ${chalk.cyan('$ db-migrate-ts generate create_users_table')}
  ${chalk.cyan('$ db-migrate-ts generate add_email_to_users --template column')}
  ${chalk.cyan('$ db-migrate-ts generate create_posts --template table')}
  ${chalk.cyan('$ db-migrate-ts generate my_migration --dir ./db/migrations')}

${chalk.bold("Generated file name format:")}
  ${chalk.gray("20241215143025_create_users_table.ts")}
  ${chalk.gray("└─ timestamp ─┘ └─── description ───┘")}
`
  )
  .action(generateCommand);

// ----------------------------------------------------------
//  validate — Validate migration files
// ----------------------------------------------------------

program
  .command("validate")
  .description("Validate all migration files without executing them")
  .option(...CONFIG_OPTION)
  .option("--sql", "Print generated SQL for each migration", false)
  .addHelpText(
    "after",
    `
${chalk.bold("Checks performed:")}
  1. All migration files load without syntax errors
  2. No duplicate timestamps
  3. No duplicate migration names
  4. Schema definition is valid (if configured)
  5. SQL generation succeeds for up() and down() functions
  6. Warnings for empty down() functions

${chalk.bold("Examples:")}
  ${chalk.cyan("$ db-migrate-ts validate")}            Validate all migrations
  ${chalk.cyan("$ db-migrate-ts validate --sql")}      Show generated SQL
`
  )
  .action(validateCommand);

// ----------------------------------------------------------
//  Error handling
// ----------------------------------------------------------

program.configureOutput({
  outputError: (str, write) => write(chalk.red(str)),
});

program.on("command:*", (operands: string[]) => {
  console.error(
    chalk.red(`\n  ❌ Unknown command: "${operands[0]}"\n`) +
      chalk.gray(`  Run "db-migrate-ts --help" for a list of available commands.\n`)
  );
  process.exit(1);
});

// Handle unhandled promise rejections from async commands
process.on("unhandledRejection", (reason) => {
  console.error(chalk.red("\n  ❌ Unhandled error:"), reason);
  process.exit(1);
});

// ============================================================
//  Parse & Execute
// ============================================================

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length <= 2) {
  program.help();
}
