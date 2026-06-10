import { buildSchema, graphql } from "graphql";
import type { GraphClientAdapter } from "@gleanql/client";
import { db, type TodoRow } from "@/db";

/**
 * The GraphQL layer behind Glean's adapter. A tiny graphql-js executor whose
 * resolvers run Kysely queries against the SQLite Durable Object — so Glean's
 * compile-time reads and mutations resolve straight out of a real database.
 *
 * Kept in sync with `schema.graphql` (which the @gleanql/vite plugin compiles from).
 */
const sdl = /* GraphQL */ `
  type Query {
    todos: [Todo!]!
  }
  type Todo { id: ID!  title: String!  completed: Boolean!  createdAt: String! }
  type Mutation {
    addTodo(id: ID!, title: String!): Todo!
    toggleTodo(id: ID!): Todo
    removeTodo(id: ID!): ID
    setTitle(id: ID!, title: String!): Todo
    setAllCompleted(completed: Boolean!): Int!
    clearCompleted: Int!
  }
`;

const schema = buildSchema(sdl);

/** A SQLite row → the GraphQL `Todo` shape (0/1 → boolean, epoch ms → string). */
const toTodo = (r: TodoRow) => ({
  id: r.id,
  title: r.title,
  completed: r.completed !== 0,
  createdAt: String(r.created_at),
});

const findTodo = async (id: string) => {
  const row = await db().selectFrom("todos").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? toTodo(row) : null;
};

const listTodos = async () =>
  (await db().selectFrom("todos").selectAll().orderBy("created_at", "desc").execute()).map(toTodo);

const rootValue = {
  // The top-level list root — resolves to the todos array directly.
  todos: listTodos,

  addTodo: async ({ id, title }: { id: string; title: string }) => {
    const row: TodoRow = { id, title: title.trim(), completed: 0, created_at: Date.now() };
    await db().insertInto("todos").values(row).execute();
    return toTodo(row);
  },

  toggleTodo: async ({ id }: { id: string }) => {
    const cur = await db().selectFrom("todos").select("completed").where("id", "=", id).executeTakeFirst();
    if (!cur) return null;
    await db().updateTable("todos").set({ completed: cur.completed === 0 ? 1 : 0 }).where("id", "=", id).execute();
    return findTodo(id);
  },

  removeTodo: async ({ id }: { id: string }) => {
    await db().deleteFrom("todos").where("id", "=", id).execute();
    return id;
  },

  setTitle: async ({ id, title }: { id: string; title: string }) => {
    await db().updateTable("todos").set({ title: title.trim() }).where("id", "=", id).execute();
    return findTodo(id);
  },

  setAllCompleted: async ({ completed }: { completed: boolean }) => {
    const res = await db().updateTable("todos").set({ completed: completed ? 1 : 0 }).execute();
    return Number(res[0]?.numUpdatedRows ?? 0n);
  },

  clearCompleted: async () => {
    const res = await db().deleteFrom("todos").where("completed", "=", 1).execute();
    return Number(res[0]?.numDeletedRows ?? 0n);
  },
};

/** Run a GraphQL document against the DB (used by the `/graphql` route + the adapter). */
export async function executeGraphQL(query: string, variables?: Record<string, unknown>) {
  const res = await graphql({ schema, source: query, variableValues: variables, rootValue });
  return { data: res.data ?? undefined, errors: res.errors?.map((e) => ({ message: e.message })) };
}

/** The adapter Glean's runtime uses (SSR preload + client refetch/mutations). */
export function makeTodoAdapter(): GraphClientAdapter {
  return {
    async execute(operation, variables) {
      return executeGraphQL(operation.document, variables as Record<string, unknown>) as never;
    },
  };
}
