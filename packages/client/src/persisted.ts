/**
 * Server-side persisted-operation allowlist.
 *
 * The build already knows every operation the app can send (the compiled
 * `operations` map carries each document + its SHA-256 hash), so the server can
 * refuse anything else. `createPersistedResolver(operations)` turns an incoming
 * request body into the document to execute — by hash (`extensions.
 * persistedQuery.sha256Hash`, the Apollo APQ wire shape the fetch adapter's
 * `persisted: true` mode sends) or by exact-document match — and rejects
 * free-form queries unless explicitly allowed.
 */

/** The slice of a compiled operation the resolver needs (the generated `operations` map satisfies it). */
export interface PersistedLookupOperation {
  readonly document: string;
  readonly hash?: string;
}

/** A GraphQL-over-HTTP request body, as parsed from JSON. */
export interface PersistedRequestBody {
  readonly query?: string;
  readonly operationName?: string;
  readonly variables?: unknown;
  readonly extensions?: {
    readonly persistedQuery?: { readonly version?: number; readonly sha256Hash?: string };
  };
}

export type PersistedResolution =
  /** Execute this document. */
  | { readonly kind: "ok"; readonly document: string }
  /** Unknown hash and no usable document — reply `PersistedQueryNotFound` so an APQ client retries with the query. */
  | { readonly kind: "not-found" }
  /** Free-form (or mismatched) query outside the allowlist — reply 4xx. */
  | { readonly kind: "rejected" };

export interface PersistedResolverOptions {
  /** Execute documents that aren't in the allowlist (turns the allowlist into hash-only transport compression). */
  readonly allowUnpersisted?: boolean;
}

export function createPersistedResolver(
  operations: Readonly<Record<string, PersistedLookupOperation>>,
  options: PersistedResolverOptions = {},
): (body: PersistedRequestBody) => PersistedResolution {
  const byHash = new Map<string, string>();
  const documents = new Set<string>();
  for (const op of Object.values(operations)) {
    documents.add(op.document);
    if (op.hash) byHash.set(op.hash, op.document);
  }

  return (body) => {
    const hash = body.extensions?.persistedQuery?.sha256Hash;
    if (hash) {
      const document = byHash.get(hash);
      if (document) return { kind: "ok", document };
      // Unknown hash + an allowlisted document (APQ register retry): execute it.
      if (body.query) {
        return documents.has(body.query) || options.allowUnpersisted
          ? { kind: "ok", document: body.query }
          : { kind: "rejected" };
      }
      return { kind: "not-found" };
    }
    if (body.query) {
      return documents.has(body.query) || options.allowUnpersisted
        ? { kind: "ok", document: body.query }
        : { kind: "rejected" };
    }
    return { kind: "rejected" };
  };
}
