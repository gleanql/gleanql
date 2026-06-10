import { buildSchema, graphql } from "graphql";
import type { GraphClientAdapter } from "@gleanql/client";

/**
 * The GraphQL layer behind GleanQL's adapter — a tiny graphql-js executor over
 * an in-memory store. Swap the resolvers for your database (rwsdk-todo shows a
 * SQLite Durable Object) or point the adapter at a remote GraphQL API instead.
 * Kept in sync with `schema.graphql` (the plugin compiles from that file).
 */
const sdl = /* GraphQL */ `
  type Query { notes: [Note!]! }
  type Note { id: ID!  text: String! }
  type Mutation { addNote(id: ID!, text: String!): Note! }
`;

const schema = buildSchema(sdl);

const notes: Array<{ id: string; text: string }> = [
  { id: "n1", text: "Read fields, get queries" },
  { id: "n2", text: "Ship one operation per route" },
];

const rootValue = {
  notes: () => notes,
  addNote: ({ id, text }: { id: string; text: string }) => {
    const note = { id, text };
    notes.unshift(note);
    return note;
  },
};

export async function executeGraphQL(source: string, variableValues?: Record<string, unknown>) {
  return graphql({ schema, source, rootValue, variableValues });
}

/** GleanQL's transport seam: execute compiled operations against the executor above. */
export const adapter: GraphClientAdapter = {
  async execute(operation, variables) {
    return (await executeGraphQL(operation.document, variables as Record<string, unknown>)) as never;
  },
};
