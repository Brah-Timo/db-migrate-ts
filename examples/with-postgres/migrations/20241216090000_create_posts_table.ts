/**
 * Migration: Create Posts Table
 * Generated: 2024-12-16T09:00:00.000Z
 *
 * Creates the posts table with:
 * - UUID primary key
 * - Title and content
 * - Author foreign key (references users)
 * - Publication timestamp (nullable = draft support)
 * - View count
 * - Tags array (JSONB)
 */

import type { Migration } from "db-migrate-ts";
import { z } from "zod";

export default {
  name: "20241216090000_create_posts_table",
  timestamp: 20241216090000,
  description: "Posts table with author foreign key",

  up: async (migrate) => {
    migrate.createTable("posts", {
      id: {
        schema: z.string().uuid(),
        primaryKey: true,
        default: "gen_random_uuid()",
      },
      title: {
        schema: z.string().max(255),
      },
      slug: {
        schema: z.string().max(300),
        unique: true,
      },
      content: {
        schema: z.string(),
      },
      excerpt: {
        schema: z.string().max(500),
        nullable: true,
      },
      authorId: {
        schema: z.string().uuid(),
        references: {
          table: "users",
          column: "id",
          onDelete: "CASCADE",
          onUpdate: "RESTRICT",
        },
      },
      publishedAt: {
        schema: z.date(),
        nullable: true,
      },
      viewCount: {
        schema: z.number().int().min(0),
        default: 0,
      },
      tags: {
        schema: z.array(z.string()),
        default: "[]",
      },
      createdAt: {
        schema: z.date(),
        default: "NOW()",
      },
    });

    // Index for author queries (most common access pattern)
    migrate.createIndex("posts", ["authorId"], {
      name: "idx_posts_author_id",
    });

    // Index for slug lookups (unique URL resolution)
    migrate.createIndex("posts", ["slug"], {
      name: "idx_posts_slug",
      unique: true,
    });

    // Partial index: only index published posts for feed queries
    migrate.createIndex("posts", ["publishedAt", "createdAt"], {
      name: "idx_posts_published_feed",
      where: "published_at IS NOT NULL",
    });
  },

  down: async (migrate) => {
    migrate.dropIndex("idx_posts_published_feed");
    migrate.dropIndex("idx_posts_slug");
    migrate.dropIndex("idx_posts_author_id");
    migrate.dropTable("posts" as never);
  },
} satisfies Migration;
