/**
 * @file logger.ts
 * @description Structured logger with chalk-powered colored output.
 */

import chalk from "chalk";

export type LogLevel = "debug" | "info" | "warn" | "error" | "success" | "silent";

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  timestamps?: boolean;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  success: 1,
  silent: 999,
};

/**
 * Structured logger with colored output for CLI and library use.
 *
 * @example
 * const logger = createLogger({ prefix: "db-migrate-ts" });
 * logger.info("Running 3 pending migrations...");
 * logger.success("Migration completed in 142ms");
 * logger.error("Migration failed:", error.message);
 */
export class Logger {
  private readonly level: LogLevel;
  private readonly prefix: string;
  private readonly timestamps: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.prefix = options.prefix ?? "";
    this.timestamps = options.timestamps ?? false;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const parts: string[] = [];

    if (this.timestamps) {
      parts.push(chalk.gray(new Date().toISOString()));
    }

    if (this.prefix) {
      parts.push(chalk.cyan(`[${this.prefix}]`));
    }

    switch (level) {
      case "debug":
        parts.push(chalk.gray("[DEBUG]"), chalk.gray(message));
        break;
      case "info":
        parts.push(chalk.blue("[INFO]"), chalk.white(message));
        break;
      case "warn":
        parts.push(chalk.yellow("[WARN]"), chalk.yellow(message));
        break;
      case "error":
        parts.push(chalk.red("[ERROR]"), chalk.red(message));
        break;
      case "success":
        parts.push(chalk.green("[OK]"), chalk.green(message));
        break;
    }

    return parts.join(" ");
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.log(this.formatMessage("debug", message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.log(this.formatMessage("info", message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message), ...args);
    }
  }

  success(message: string, ...args: unknown[]): void {
    if (this.shouldLog("success")) {
      console.log(this.formatMessage("success", message), ...args);
    }
  }

  /** Prints a blank line */
  blank(): void {
    if (this.level !== "silent") {
      console.log();
    }
  }

  /** Prints a horizontal divider */
  divider(char = "─", width = 60): void {
    if (this.level !== "silent") {
      console.log(chalk.gray(char.repeat(width)));
    }
  }

  /** Prints a migration status line (for the status command table) */
  table(rows: Array<Record<string, string | number>>): void {
    if (this.level === "silent" || rows.length === 0) return;

    const headers = Object.keys(rows[0] ?? {});
    const widths = headers.map((h) =>
      Math.max(h.length, ...rows.map((r) => String(r[h] ?? "").length))
    );

    const header = headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join("  ");
    const divider = widths.map((w) => "─".repeat(w)).join("  ");

    console.log(chalk.bold.white(header));
    console.log(chalk.gray(divider));
    for (const row of rows) {
      const line = headers.map((h, i) => String(row[h] ?? "").padEnd(widths[i] ?? 0)).join("  ");
      console.log(line);
    }
  }
}

/** Default logger instance — can be overridden by user config */
export const defaultLogger = new Logger({ prefix: "db-migrate-ts" });

/** Factory function for creating customized loggers */
export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}
