import { env } from "cloudflare:workers";
import { createDb, SqliteDurableObject } from "rwsdk/db";
import type { Kysely } from "kysely";
import { migrations } from "./migrations";

/** The SQLite row shape (Kysely is typed against this). */
export interface TodoRow {
  id: string;
  title: string;
  completed: number; // SQLite has no boolean — 0/1
  created_at: number;
}

export interface DatabaseSchema {
  todos: TodoRow;
}

/**
 * The Durable Object that owns the SQLite database. RedwoodSDK's `SqliteDurableObject`
 * runs our migrations on first access; the worker talks to it through a Kysely client
 * (see {@link db}). Exported from the worker entry and bound as `TODO_DB`.
 */
export class TodoDatabase extends SqliteDurableObject<DatabaseSchema> {
  constructor(ctx: DurableObjectState, e: unknown) {
    super(ctx, e, migrations);
  }
}

/** A typed Kysely client over the todo Durable Object, resolved per request. */
export function db(): Kysely<DatabaseSchema> {
  return createDb<DatabaseSchema>((env as { TODO_DB: DurableObjectNamespace }).TODO_DB, "todos");
}
