/**
 * @file generate.command.ts
 * @description CLI command: `db-migrate-ts generate <name>`
 *
 * Generates a new migration file with the correct timestamp prefix,
 * in the configured migrations directory.
 *
 * Templates:
 *   --template blank    → empty up/down functions
 *   --template table    → createTable / dropTable boilerplate
 *   --template column   → addColumn / dropColumn boilerplate
 */

import chalk from "chalk";
import { resolve, join } from "path";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import type { OptionValues } from "commander";
import { loadConfig } from "../config-loader.js";
import { generateTimestamp, sanitizeMigrationName } from "db-migrate-ts/src/utils/file-loader";

export interface GenerateOptions extends OptionValues {
  config: string;
  dir?: string;
  template: "blank" | "table" | "column";
  typescript: boolean;
}

type TemplateType = "blank" | "table" | "column";

/**
 * Handles the `db-migrate-ts generate <name>` command.
 */
export async function generateCommand(
  rawName: string,
  options: GenerateOptions
): Promise<void> {
  console.log(chalk.cyan.bold("\n⚡ db-migrate-ts") + chalk.gray(" — generating migration\n"));

  // Sanitize the migration name
  const sanitizedName = sanitizeMigrationName(rawName);
  if (!sanitizedName) {
    console.error(chalk.red(`❌ Invalid migration name: "${rawName}"`));
    console.error(
      chalk.gray(
        "  Use letters, numbers, hyphens, and spaces. Example: create_users_table"
      )
    );
    process.exit(1);
  }

  // Determine the migrations directory
  let migrationsDir: string;
  if (options.dir) {
    migrationsDir = resolve(options.dir);
  } else {
    try {
      const config = await loadConfig(options.config);
      migrationsDir = resolve(config.migrationsDir);
    } catch {
      // Fallback to default if config not found
      migrationsDir = resolve("./migrations");
    }
  }

  // Create the directory if it doesn't exist
  if (!existsSync(migrationsDir)) {
    await mkdir(migrationsDir, { recursive: true });
    console.log(chalk.gray(`  📁 Created migrations directory: ${migrationsDir}`));
  }

  // Generate the timestamp and filename
  const timestamp = generateTimestamp();
  const filename = `${timestamp}_${sanitizedName}.ts`;
  const filepath = join(migrationsDir, filename);

  // Check if file already exists (shouldn't happen with timestamp, but safety check)
  if (existsSync(filepath)) {
    console.error(chalk.red(`❌ File already exists: ${filepath}`));
    process.exit(1);
  }

  // Generate content from template
  const template = options.template as TemplateType;
  const content = generateTemplate(template, timestamp, sanitizedName);

  // Write the file
  await writeFile(filepath, content, "utf-8");

  console.log(
    chalk.green(`  ✅ Created: `) +
    chalk.white(filename)
  );
  console.log(chalk.gray(`  📍 Location: ${filepath}`));
  console.log();
  console.log(chalk.gray("  Next step: Edit your migration, then run:"));
  console.log(chalk.cyan("    db-migrate-ts up"));
  console.log();
}

// ============================================================
//  Templates
// ============================================================

function generateTemplate(
  template: TemplateType,
  timestamp: string,
  name: string
): string {
  const migrationName = `${timestamp}_${name}`;
  const displayName = name.replace(/_/g, " ");

  switch (template) {
    case "table":
      return generateTableTemplate(migrationName, name, displayName);
    case "column":
      return generateColumnTemplate(migrationName, displayName);
    case "blank":
    default:
      return generateBlankTemplate(migrationName, displayName);
  }
}

function generateBlankTemplate(migrationName: string, displayName: string): string {
  return `/**
 * Migration: ${displayName}
 * Generated: ${new Date().toISOString()}
 */

import type { Migration } from "db-migrate-ts";
import { z } from "zod";

export default {
  name: "${migrationName}",
  timestamp: ${migrationName.split("_")[0]},

  up: async (migrate) => {
    // TODO: Add your up migration here
    // Example:
    // migrate.createTable("example", {
    //   id: { schema: z.number().int(), primaryKey: true },
    //   name: { schema: z.string().max(100) },
    // });
  },

  down: async (migrate) => {
    // TODO: Add your down migration here (reverse of up)
    // Example:
    // migrate.dropTable("example");
  },
} satisfies Migration;
`;
}

function generateTableTemplate(
  migrationName: string,
  snakeName: string,
  displayName: string
): string {
  // Extract table name from migration name (remove common prefixes)
  const tableName =
    snakeName
      .replace(/^create_/, "")
      .replace(/^add_/, "")
      .replace(/_table$/, "") || snakeName;

  return `/**
 * Migration: ${displayName}
 * Generated: ${new Date().toISOString()}
 */

import type { Migration } from "db-migrate-ts";
import { z } from "zod";

export default {
  name: "${migrationName}",
  timestamp: ${migrationName.split("_")[0]},

  up: async (migrate) => {
    migrate.createTable("${tableName}", {
      id: {
        schema: z.string().uuid(),
        primaryKey: true,
        default: "gen_random_uuid()",  // PostgreSQL; remove for other DBs
      },
      // TODO: Add your columns here
      // name: { schema: z.string().max(100) },
      // email: { schema: z.string().email(), unique: true },
      // isActive: { schema: z.boolean(), default: true },
      createdAt: {
        schema: z.date(),
        default: "NOW()",
      },
      updatedAt: {
        schema: z.date(),
        default: "NOW()",
      },
    });

    // Create indexes
    // migrate.createIndex("${tableName}", ["email"], { unique: true, name: "idx_${tableName}_email" });
  },

  down: async (migrate) => {
    // migrate.dropIndex("idx_${tableName}_email");
    migrate.dropTable("${tableName}");
  },
} satisfies Migration;
`;
}

function generateColumnTemplate(migrationName: string, displayName: string): string {
  return `/**
 * Migration: ${displayName}
 * Generated: ${new Date().toISOString()}
 */

import type { Migration } from "db-migrate-ts";
import { z } from "zod";

export default {
  name: "${migrationName}",
  timestamp: ${migrationName.split("_")[0]},

  up: async (migrate) => {
    // TODO: Add your column here
    migrate.addColumn("your_table", "new_column", {
      schema: z.string().max(100),
      nullable: true,
    });
  },

  down: async (migrate) => {
    // TODO: Reverse the up migration
    migrate.dropColumn("your_table", "new_column");
  },
} satisfies Migration;
`;
}
