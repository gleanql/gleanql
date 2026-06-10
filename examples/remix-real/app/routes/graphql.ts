import { executeGraphQL } from "@gleanql/storefront-fixture";

// Resource route (no component): the endpoint the generated client glue POSTs to
// for `refresh()` (client-side refetch).
export async function action({ request }: { request: Request }) {
  const { query, variables } = (await request.json()) as { query: string; variables?: Record<string, unknown> };
  const result = await executeGraphQL(query, variables);
  return Response.json(result);
}
