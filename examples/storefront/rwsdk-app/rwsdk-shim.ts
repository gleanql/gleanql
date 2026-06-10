import { toVNode, type VNode } from "../app/jsx-runtime.js";
import { renderToString } from "../app/render.js";

/**
 * A minimal, faithful stand-in for `rwsdk/worker` — just enough of RedwoodSDK's
 * request model to run a worker in plain Node (the real `rwsdk/worker` needs
 * workerd + the RSC build, which can't boot inside vitest). It mirrors the exact
 * shapes RedwoodSDK exposes, so swapping this import for the real one is the only
 * change needed for a Cloudflare deploy:
 *
 *   import { defineApp, route } from "rwsdk/worker";   // ← real
 *   import { defineApp, route } from "./rwsdk-shim";    // ← here
 *
 * A handler list is processed in order: middleware functions run first (they may
 * mutate `ctx` or short-circuit with a `Response`), then the first matching
 * route renders its Page wrapped in the Document.
 */
export interface RequestInfo<Ctx extends Record<string, unknown> = Record<string, unknown>> {
  readonly request: Request;
  readonly params: Record<string, string>;
  readonly ctx: Ctx;
  readonly response: { status: number; headers: Headers };
}

export type Middleware<Ctx extends Record<string, unknown> = Record<string, unknown>> = (
  requestInfo: RequestInfo<Ctx>,
) => void | Response | Promise<void | Response>;

export type PageHandler<Ctx extends Record<string, unknown> = Record<string, unknown>> = (
  requestInfo: RequestInfo<Ctx>,
) => unknown | Promise<unknown>;

export interface RouteDef<Ctx extends Record<string, unknown> = Record<string, unknown>> {
  readonly kind: "route";
  readonly pattern: string;
  readonly match: RegExp;
  readonly paramNames: readonly string[];
  readonly handler: PageHandler<Ctx>;
}

export function route<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  pattern: string,
  handler: PageHandler<Ctx>,
): RouteDef<Ctx> {
  const paramNames: string[] = [];
  const source = pattern.replace(/:[A-Za-z0-9_]+/g, (m) => {
    paramNames.push(m.slice(1));
    return "([^/]+)";
  });
  return { kind: "route", pattern, match: new RegExp(`^${source}/?$`), paramNames, handler };
}

export interface Document<Ctx extends Record<string, unknown> = Record<string, unknown>> {
  (props: { children: string; requestInfo: RequestInfo<Ctx> }): string;
}

export interface DefineAppOptions<Ctx extends Record<string, unknown>> {
  readonly Document: Document<Ctx>;
  /** Render the Page VNode to HTML (the seam where the app installs its scope). */
  readonly render?: (vnode: VNode, requestInfo: RequestInfo<Ctx>) => Promise<string> | string;
  /** Build the initial per-request `ctx`. */
  readonly context?: () => Ctx;
}

export interface Worker {
  fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response>;
}

export function defineApp<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  handlers: ReadonlyArray<Middleware<Ctx> | RouteDef<Ctx>>,
  options: DefineAppOptions<Ctx>,
): Worker {
  const render = options.render ?? ((vnode) => renderToString(vnode));

  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const requestInfo: RequestInfo<Ctx> = {
        request,
        params: {},
        ctx: options.context ? options.context() : ({} as Ctx),
        response: { status: 200, headers: new Headers({ "content-type": "text/html; charset=utf-8" }) },
      };

      for (const handler of handlers) {
        if (typeof handler === "function") {
          const early = await handler(requestInfo);
          if (early instanceof Response) return early;
          continue;
        }
        const m = handler.match.exec(url.pathname);
        if (!m) continue;

        handler.paramNames.forEach((name, i) => {
          (requestInfo.params as Record<string, string>)[name] = decodeURIComponent(m[i + 1]!);
        });

        const out = await handler.handler(requestInfo);
        if (out instanceof Response) return out;

        const body = await render(toVNode(out), requestInfo);
        const html = options.Document({ children: body, requestInfo });
        return new Response(html, { status: requestInfo.response.status, headers: requestInfo.response.headers });
      }

      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
    },
  };
}
