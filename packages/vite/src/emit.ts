// Code generators for the provisioned `@gleanql/client` package, grouped by concern:
//  - emit/operations.ts — the portable data module (operations + schema) + its .d.ts
//  - emit/accessor.ts    — the request-scoped `graph` accessor + the typed index.d.ts
//  - emit/glue.ts        — the framework glue entrypoints (thin shims over @gleanql/client factories)
//  - emit/resolver.ts    — the request-scope `__active()` snippets (internal to the above)
//
// All generators emit plain strings: the runtime LOGIC lives in @gleanql/client
// source (createGraphClient/createGraphServer), so these only emit thin shims,
// data, and `.d.ts` (which an AST/Babel emitter could not produce anyway).
export { evalSchemaModel, genOperationsJs, genOperationsDts, genPersistedManifest } from "./emit/operations.js";
export { renderOperationTypes } from "./emit/operation-types.js";
export { renderReadMask } from "./emit/readmask.js";
export { genGeneratedJs, genIndexDts } from "./emit/accessor.js";
export {
  genClientJs,
  genClientDts,
  genServerJs,
  genServerDts,
  genClientSpaJs,
  genClientSpaDts,
} from "./emit/glue.js";
