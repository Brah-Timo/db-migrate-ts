/**
 * @file dialects/index.ts
 * @description Re-exports all database dialect adapters.
 */

export { BaseDialectAdapter } from "./base.dialect.js";

export {
  PostgresAdapter,
  createPostgresAdapter,
} from "./postgres.dialect.js";

export {
  MySQLAdapter,
  createMySQLAdapter,
} from "./mysql.dialect.js";

export {
  SQLiteAdapter,
  createSQLiteAdapter,
} from "./sqlite.dialect.js";
