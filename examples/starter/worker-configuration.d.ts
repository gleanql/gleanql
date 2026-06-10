/* eslint-disable */
// Cloudflare bindings for this worker (hand-written; `npm run generate` regenerates).
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    TODO_DB: DurableObjectNamespace;
  }
}
interface Env extends Cloudflare.Env {}
