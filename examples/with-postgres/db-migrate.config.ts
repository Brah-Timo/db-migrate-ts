/**
 * db-migrate.config.ts — PostgreSQL example configuration
 *
 * Run migrations:
 *   npx db-migrate-ts up
 *   npx db-migrate-ts status
 *   npx db-migrate-ts down
 */

import { defineConfig, createPostgresAdapter } from "db-migrate-ts";
import { z } from "zod";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/myapp_dev";

export default defineConfig({
  adapter: "postgres",
  connection: await createPostgresAdapter(DATABASE_URL),
  migrationsDir: "./migrations",

  schema: {
    users: {
      id:           { schema: z.string().uuid(), primaryKey: true },
      email:        { schema: z.string().email().max(254), unique: true },
      displayName:  { schema: z.string().max(100) },
      passwordHash: { schema: z.string() },
      isVerified:   { schema: z.boolean(), default: false },
      role:         { schema: z.enum(["admin", "user", "moderator"]), default: "user" },
      metadata:     { schema: z.object({}).passthrough(), nullable: true },
      createdAt:    { schema: z.date(), default: "NOW()" },
      updatedAt:    { schema: z.date(), default: "NOW()" },
    },
    posts: {
      id:          { schema: z.string().uuid(), primaryKey: true },
      title:       { schema: z.string().max(255) },
      slug:        { schema: z.string().max(300), unique: true },
      content:     { schema: z.string() },
      excerpt:     { schema: z.string().max(500), nullable: true },
      authorId:    {
        schema: z.string().uuid(),
        references: { table: "users", column: "id", onDelete: "CASCADE" },
      },
      publishedAt: { schema: z.date(), nullable: true },
      viewCount:   { schema: z.number().int().min(0), default: 0 },
      tags:        { schema: z.array(z.string()), default: "[]" },
      createdAt:   { schema: z.date(), default: "NOW()" },
    },
  },

  options: {
    validateChecksums: true,
    saveSQLSnapshots: true,
    snapshotsDir: "./migrations/snapshots",
  },
});
