import type { GraphRequestContext } from "./adapter.js";

/**
 * Structural RWSDK types.
 *
 * This package never imports `rwsdk` — like `@gleanql/vite`, it is decoupled from
 * the host framework and matches its shapes structurally, so it can be tested in
 * isolation and won't pin a framework version. A RedwoodSDK route handler / Page
 * receives a `RequestInfo`:
 *   route("/product/:handle", ({ request, params, ctx }) => <ProductRoute ... />)
 */
export interface RequestInfo<Ctx extends Record<string, unknown> = Record<string, unknown>> {
  readonly request: Request;
  /** Dynamic route segments, e.g. `params.handle`, `params.$0`. */
  readonly params: Record<string, string>;
  /** Per-request mutable app context populated by middleware. */
  readonly ctx: Ctx;
  /** RedwoodSDK-specific context (opaque here). */
  readonly rw?: unknown;
  /** Cloudflare ExecutionContext. */
  readonly cf?: unknown;
  /** Mutable ResponseInit (status/headers). */
  readonly response?: ResponseInit;
}

/**
 * The route context object handed to the compiled variables factory *and* used
 * as the transport `GraphRequestContext`. The compiler emits factories that read
 * `ctx.params.handle`, `ctx.search.get(...)`, etc., so this shape is the contract
 * between the generated code and the adapter.
 */
export interface GraphRouteContext extends GraphRequestContext {
  readonly params: Record<string, string>;
  readonly search: URLSearchParams;
  readonly request: Request;
  /** Application context contributed by `options.context` (auth, locale, env, ...). */
  readonly [key: string]: unknown;
}

export interface BuildRouteContextOptions<Ctx extends Record<string, unknown>> {
  /**
   * Contribute application context (shop domain, access token, locale, market,
   * preview mode, Cloudflare env). Anything returned here is available to the
   * variables factory and to the transport adapter's header builder.
   */
  readonly context?: (requestInfo: RequestInfo<Ctx>) => Record<string, unknown>;
}

/**
 * Build the route/request context from a RequestInfo. `params` and `search` come
 * from the URL; everything else is contributed by `options.context`. The raw
 * `request` is included for header derivation but is *not* serialized to the
 * client (see `serializeGraph`).
 */
export function buildRouteContext<Ctx extends Record<string, unknown>>(
  requestInfo: RequestInfo<Ctx>,
  options: BuildRouteContextOptions<Ctx> = {},
): GraphRouteContext {
  const url = new URL(requestInfo.request.url);
  const app = options.context?.(requestInfo) ?? {};
  return {
    ...app,
    params: requestInfo.params,
    search: url.searchParams,
    request: requestInfo.request,
  };
}
