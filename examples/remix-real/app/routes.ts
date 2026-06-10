import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("collections/:handle", "routes/collection.tsx"),
  route("products/:handle", "routes/product.tsx"),
  route("graphql", "routes/graphql.ts"), // resource route (client refetch endpoint)
] satisfies RouteConfig;
