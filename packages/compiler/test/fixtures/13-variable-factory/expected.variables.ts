export function getProductRouteVariables(ctx) {
  const handle = ctx.params.handle.toLowerCase();
  return {
    product_handle: handle,
  };
}
