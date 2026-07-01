import { GraphCache, type GraphRef, type FieldValue } from "./cache.js";
import { normalizeValue, seedResult, type KeyOf } from "./normalize.js";

/**
 * Suspense-aware graph runtime.
 *
 * A field read is synchronous on a cache hit. On a miss it enqueues the missing
 * (ref, field), creates exactly one cached promise for it, and throws that
 * promise (the Suspense contract). Multiple misses in the same tick batch into
 * a single `fetchMissing` call. Re-reading a pending field throws the same
 * promise — no duplicate request, stable across React render retries.
 */
export interface MissingFieldRead {
  readonly ref: GraphRef;
  readonly fieldKey: string;
}

export interface MissingFieldResult {
  readonly ref: GraphRef;
  readonly fieldKey: string;
  readonly value: FieldValue;
}

export type MissingFieldMode = "allow" | "warn" | "error";

export interface GraphRuntimeOptions {
  /** Batched fetcher for fields not present in the seeded operation. */
  readonly fetchMissing: (misses: readonly MissingFieldRead[]) => Promise<readonly MissingFieldResult[]>;
  readonly cache?: GraphCache;
  /** How to identify entities during normalization (defaults to the `id` field). */
  readonly keyOf?: KeyOf;
  /** Behavior when a field absent from the compiled operation is read. */
  readonly unexpectedMissingField?: MissingFieldMode;
  /** dev-only: warn with component/field context. */
  readonly onWarn?: (message: string) => void;
  /** Microtask scheduler (overridable in tests). */
  readonly schedule?: (cb: () => void) => void;
  /** Optional LRU cap for the cache (least-recently-used records evicted past it). */
  readonly maxCacheRecords?: number;
}

interface PendingEntry {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

export class GraphRuntime {
  readonly cache: GraphCache;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly resolvedRoots = new Map<string, Record<string, FieldValue>>();
  private queue: MissingFieldRead[] = [];
  private flushScheduled = false;

  constructor(private readonly options: GraphRuntimeOptions) {
    this.cache = options.cache ?? new GraphCache(options.maxCacheRecords);
  }

  /** Synchronous on hit; throws a (cached) promise on miss. */
  readField(ref: GraphRef, fieldKey: string, debug?: { component?: string }): FieldValue {
    const got = this.cache.getField(ref, fieldKey);
    if (got.status === "ready") return got.value;

    this.reportMiss(ref, fieldKey, debug);

    const pkey = this.pendingKey(ref, fieldKey);
    const existing = this.pending.get(pkey);
    if (existing) throw existing.promise;

    const entry = this.makeDeferred();
    this.pending.set(pkey, entry);
    this.queue.push({ ref, fieldKey });
    this.scheduleFlush();
    throw entry.promise;
  }

  /**
   * Suspense primitive for a render-time ("two-sweep") root read: run `exec`
   * once per `key` (it fetches the root with the call-site args and seeds the
   * cache), throwing its promise until it resolves, then return the seeded root
   * refs. Mirrors `readField`'s pending/throw/resume, keyed by the root field +
   * its args. Because `exec` SEEDS before resolving, every subsequent field read
   * on the returned refs is a cache hit — so a deferred root's fields never reach
   * `reportMiss` (they aren't "unexpected" misses).
   */
  resolveRoot(key: string, exec: () => Promise<Record<string, FieldValue>>): Record<string, FieldValue> {
    const done = this.resolvedRoots.get(key);
    if (done) return done;

    const pkey = `@root:${key}`;
    const existing = this.pending.get(pkey);
    if (existing) throw existing.promise; // dedupe in-flight / stable across retries

    const entry = this.makeDeferred();
    this.pending.set(pkey, entry);
    exec().then(
      (roots) => {
        this.resolvedRoots.set(key, roots);
        this.pending.delete(pkey);
        entry.resolve();
      },
      (error) => {
        this.pending.delete(pkey);
        entry.reject(error);
      },
    );
    throw entry.promise;
  }

  /**
   * Async twin of {@link resolveRoot} for non-React callers (server handlers,
   * proxy): run `exec` once per `key` and RESOLVE to the seeded root refs instead
   * of throwing a Suspense promise. Shares the `resolvedRoots` cache and the
   * `pending` map with `resolveRoot`, so an `await` and a concurrent sync (thrown)
   * read of the same root+args dedupe to a single in-flight fetch.
   */
  async resolveRootAsync(key: string, exec: () => Promise<Record<string, FieldValue>>): Promise<Record<string, FieldValue>> {
    const done = this.resolvedRoots.get(key);
    if (done) return done;

    const pkey = `@root:${key}`;
    const existing = this.pending.get(pkey);
    if (existing) {
      // A sync read already kicked off this fetch — await it, then read the cache.
      await existing.promise;
      return this.resolvedRoots.get(key) ?? {};
    }

    const entry = this.makeDeferred();
    // The barrier promise only exists to signal concurrent readers (a sync reader
    // `throw`s it, an async reader `await`s it). On the solo path nothing attaches
    // to it, so observe its rejection here — the error still propagates to THIS
    // caller via the `throw` below; without this a failing `await glean.x()` would
    // surface an unhandled rejection (noisy / isolate-fatal in a Worker).
    entry.promise.catch(() => {});
    this.pending.set(pkey, entry);
    try {
      const roots = await exec();
      this.resolvedRoots.set(key, roots);
      this.pending.delete(pkey);
      entry.resolve();
      return roots;
    } catch (error) {
      this.pending.delete(pkey);
      entry.reject(error);
      throw error;
    }
  }

  /** Seed a record's fields (e.g. from the compiled operation result). */
  seed(ref: GraphRef, fields: Readonly<Record<string, FieldValue>>): void {
    this.cache.merge(ref, fields);
  }

  /** Normalize a full operation result into the cache; returns root refs. */
  seedResult(data: Readonly<Record<string, unknown>>, options?: { rootPath?: string }): Record<string, FieldValue> {
    return seedResult(this.cache, data, { keyOf: this.options.keyOf, ...options });
  }

  /**
   * Low-level pagination primitive: append a freshly-fetched page onto a cached
   * connection. Normalizes the page's `nodes` and concats them after the existing
   * ones, and (if present) replaces `pageInfo`. Every reader of the connection
   * re-renders with the longer `nodes` array. This makes no assumptions about HOW
   * the page was fetched or which cursor convention the schema uses — the app fetches
   * the next page however it likes (the connection's ref is available via
   * `selectionOf(value)`), then hands the page object here to merge it in.
   */
  appendConnection(
    connectionRef: GraphRef,
    page: Record<string, unknown>,
    mergeRefs?: (existing: readonly FieldValue[], incoming: readonly FieldValue[]) => readonly FieldValue[],
  ): void {
    const keyOf = this.options.keyOf;
    const anchor = this.cache.recordKey(connectionRef);
    const existing = this.cache.getField(connectionRef, "nodes");
    const prior = existing.status === "ready" && Array.isArray(existing.value) ? existing.value : [];

    if (Array.isArray(page.nodes)) {
      const fresh = page.nodes.map((n, i) =>
        normalizeValue(this.cache, n, anchor, `nodes.${prior.length + i}`, keyOf),
      );
      const merged = mergeRefs ? mergeRefs(prior, fresh) : [...prior, ...fresh];
      this.cache.setField(connectionRef, "nodes", [...merged]);
    }
    if (page.pageInfo != null) {
      this.cache.setField(connectionRef, "pageInfo", normalizeValue(this.cache, page.pageInfo, anchor, "pageInfo", keyOf));
    }
  }

  /** Invalidate a record (e.g. after a mutation) and clear its pending reads. */
  invalidate(ref: GraphRef): void {
    const prefix = `${this.cache.recordKey(ref)}.`;
    this.cache.invalidate(ref);
    for (const key of [...this.pending.keys()]) {
      if (key.startsWith(prefix)) this.pending.delete(key);
    }
  }

  /** Serialize the cache for hydration across the server/client boundary. */
  snapshot(): Record<string, Record<string, FieldValue>> {
    return this.cache.snapshot();
  }

  /**
   * Fold a snapshot into the live cache (write only, no notify); returns whether
   * anything changed. Use for a per-navigation merge where the notify is deferred
   * to a commit-phase effect (see `serialize.ts#absorbHydrationPayload`).
   */
  absorbRecords(snapshot: Record<string, Record<string, FieldValue>>): boolean {
    return this.cache.absorbRecords(snapshot);
  }

  /** Notify subscribers after one or more `absorbRecords` calls. */
  notify(): void {
    this.cache.notify();
  }

  /** Convenience: absorb a snapshot and notify if it changed (non-React callers). */
  absorb(snapshot: Record<string, Record<string, FieldValue>>): boolean {
    const changed = this.cache.absorbRecords(snapshot);
    if (changed) this.cache.notify();
    return changed;
  }

  static hydrate(
    snapshot: Record<string, Record<string, FieldValue>>,
    options: Omit<GraphRuntimeOptions, "cache">,
  ): GraphRuntime {
    return new GraphRuntime({ ...options, cache: GraphCache.fromSnapshot(snapshot, options.maxCacheRecords) });
  }

  private reportMiss(ref: GraphRef, fieldKey: string, debug?: { component?: string }): void {
    const mode = this.options.unexpectedMissingField ?? "allow";
    if (mode === "allow") return;
    const where = debug?.component ? ` (read by ${debug.component})` : "";
    const message = `Runtime graph field miss: ${this.cache.recordKey(ref)}.${fieldKey}${where} was not in the compiled operation.`;
    if (mode === "error") throw new Error(message);
    (this.options.onWarn ?? ((m) => console.warn(m)))(message);
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    const schedule = this.options.schedule ?? queueMicrotask;
    schedule(() => void this.flush());
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    const misses = this.queue;
    this.queue = [];
    if (misses.length === 0) return;

    try {
      const results = await this.options.fetchMissing(misses);
      for (const r of results) this.cache.setField(r.ref, r.fieldKey, r.value);
      for (const miss of misses) {
        const pkey = this.pendingKey(miss.ref, miss.fieldKey);
        this.pending.get(pkey)?.resolve();
        this.pending.delete(pkey);
      }
    } catch (error) {
      for (const miss of misses) {
        const pkey = this.pendingKey(miss.ref, miss.fieldKey);
        this.pending.get(pkey)?.reject(error);
        this.pending.delete(pkey);
      }
    }
  }

  /** Stable key for a pending (ref, field) read — also the `invalidate` prefix base. */
  private pendingKey(ref: GraphRef, fieldKey: string): string {
    return `${this.cache.recordKey(ref)}.${fieldKey}`;
  }

  private makeDeferred(): PendingEntry {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }
}
