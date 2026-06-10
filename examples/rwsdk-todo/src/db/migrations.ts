import type { Kysely, Migration } from "kysely";

/**
 * In-memory migrations for the todo store. RedwoodSDK's `SqliteDurableObject` runs
 * these on first access (via Kysely's Migrator), so the schema is created lazily
 * inside the Durable Object — no separate migrate step.
 */
export const migrations: Record<string, Migration> = {
  "0001_create_todos": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable("todos")
        .addColumn("id", "text", (c) => c.primaryKey())
        .addColumn("title", "text", (c) => c.notNull())
        .addColumn("completed", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("created_at", "integer", (c) => c.notNull())
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable("todos").execute();
    },
  },
};
