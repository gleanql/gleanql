/**
 * Graph cache with two storage identities (per the brief):
 *  - Normalized entity storage, keyed by `__typename + id`.
 *  - Operation/path storage, keyed by `root + args + path`, for objects with
 *    no `id`.
 * Two query paths returning the same `__typename + id` resolve to one record,
 * so an update through any path is visible through all of them.
 */

/** A reference to a cached record: an identified entity or a path-anchored object. */
export interface GraphRef {
  readonly __typename?: string;
  readonly id?: string | number;
  /** Path identity, e.g. `Query.product(handle).featuredImage`. */
  readonly path?: string;
}

export type FieldValue = unknown;

export type FieldLookup =
  | { readonly status: "ready"; readonly value: FieldValue }
  | { readonly status: "missing" };

/** Separator joining a record key + field key into one field-tracking key (NUL — never in a key). */
const FIELD_SEP = "\u0000";

function fieldTrackingKey(recordKey: string, fieldKey: string): string {
  return recordKey + FIELD_SEP + fieldKey;
}

export class GraphCache {
  private readonly records = new Map<string, Map<string, FieldValue>>();

  /**
   * Optional LRU cap. The client cache accumulates entities across navigations; a
   * long session would otherwise grow without bound. When set, the least-recently
   * used records are evicted past the cap. Unset (default) = unbounded, so the
   * server's per-request cache and existing callers are unchanged.
   */
  constructor(private readonly maxRecords?: number) {}

  /**
   * Reactivity substrate. Every write bumps `version` and notifies listeners, so
   * UI can re-render after a mutation, refetch, or peer-tab/subscription update.
   * `version` + `subscribe` are exactly the `useSyncExternalStore` contract.
   */
  private _version = 0;
  private readonly listeners = new Set<() => void>();

  /**
   * Version counters for fine-grained reactivity, at two granularities. A component
   * tracks the keys it read during render; its `useSyncExternalStore` snapshot is a
   * digest of those keys' versions, so a global notify only re-renders the components
   * whose keys actually changed (valtio's approach — no per-key subscription fan-out).
   *
   *  - `recordVersions` bumps on ANY write to a record (record-level trackers, e.g.
   *    `usePaginated` watching a connection).
   *  - `fieldVersions` bumps only the written field (field-level trackers, e.g.
   *    `useGlean`, so reading `product.title` ignores a write to `product.views`).
   *
   * The global `version`/`subscribe` stay the notify channel; both granularities are
   * resolved through {@link trackedVersion}.
   */
  private readonly recordVersions = new Map<string, number>();
  private readonly fieldVersions = new Map<string, number>();

  /** Current version of a record (0 if never written). */
  recordVersion(key: string): number {
    return this.recordVersions.get(key) ?? 0;
  }

  /** Current version of a single field on a record (0 if never written). */
  fieldVersion(recordKey: string, fieldKey: string): number {
    return this.fieldVersions.get(fieldTrackingKey(recordKey, fieldKey)) ?? 0;
  }

  /** The opaque tracking key a field read records; resolve it with {@link trackedVersion}. */
  fieldTrackingKey(recordKey: string, fieldKey: string): string {
    return fieldTrackingKey(recordKey, fieldKey);
  }

  /** Version of a tracked key: a bare record key, or `record\0field` for a single field. */
  trackedVersion(trackingKey: string): number {
    return trackingKey.includes(FIELD_SEP)
      ? this.fieldVersions.get(trackingKey) ?? 0
      : this.recordVersion(trackingKey);
  }

  /** Bump a record's version + (optionally) one of its fields' versions. */
  private bumpRecord(key: string, fieldKey?: string): void {
    this.recordVersions.set(key, (this.recordVersions.get(key) ?? 0) + 1);
    if (fieldKey !== undefined) this.bumpField(key, fieldKey);
  }

  private bumpField(recordKey: string, fieldKey: string): void {
    const k = fieldTrackingKey(recordKey, fieldKey);
    this.fieldVersions.set(k, (this.fieldVersions.get(k) ?? 0) + 1);
  }

  get version(): number {
    return this._version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private bump(): void {
    this._version++;
    for (const listener of this.listeners) listener();
  }

  /** Public notify: bump the version + run listeners (e.g. after `absorbRecords`). */
  notify(): void {
    this.bump();
  }

  /** Stable storage key for a ref: entity identity wins over path identity. */
  recordKey(ref: GraphRef): string {
    if (ref.__typename != null && ref.id != null) return `${ref.__typename}:${ref.id}`;
    if (ref.path != null) return `path:${ref.path}`;
    throw new Error("GraphRef requires either (__typename + id) or path");
  }

  /**
   * Reference-counted retention (Relay-style). A mounted reader retains the
   * records it displays; retained records are never LRU-evicted and survive
   * {@link gc}. The tracking hooks do this automatically — each component
   * retains what it read while mounted — so `gc()` is safe to call any time
   * (e.g. on navigation): it can only drop records nothing on screen reads.
   */
  private readonly retainCounts = new Map<string, number>();

  /** Pin a record. Returns the matching release; calling it twice is a no-op. */
  retain(key: string): () => void {
    this.stamp(key); // a mount counts as activity for staleness-aware gc
    this.retainCounts.set(key, (this.retainCounts.get(key) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = this.retainCounts.get(key) ?? 0;
      if (n <= 1) this.retainCounts.delete(key);
      else this.retainCounts.set(key, n - 1);
    };
  }

  isRetained(key: string): boolean {
    return this.retainCounts.has(key);
  }

  /** The record key a tracked key belongs to (strips the `\0field` part, if any). */
  trackedRecordKey(trackingKey: string): string {
    const i = trackingKey.indexOf(FIELD_SEP);
    return i === -1 ? trackingKey : trackingKey.slice(0, i);
  }

  /**
   * Generation clock for staleness-aware GC. The glue advances it on each page
   * navigation; every read/write/retain stamps the record with the current
   * epoch. "Unretained" alone is NOT a reason to drop data (a back-navigation
   * should hit a warm cache) — `gc({ keepEpochs })` drops only records that are
   * unretained AND haven't been touched for that many generations.
   */
  private epoch = 0;
  private readonly lastActive = new Map<string, number>();

  /** Advance the generation clock (call on navigation). Returns the new epoch. */
  advanceEpoch(): number {
    return ++this.epoch;
  }

  private stamp(key: string): void {
    this.lastActive.set(key, this.epoch);
  }

  /**
   * Drop unretained records; returns how many were dropped. Version counters
   * survive, so if a dropped record is refetched its trackers still see
   * monotonic versions.
   *
   * - `gc()` — drop EVERY unretained record (a full reset, e.g. logout).
   * - `gc({ keepEpochs: N })` — drop only records also untouched for ≥ N
   *   generations (see {@link advanceEpoch}); recently-used data stays warm
   *   for back-navigation even though nothing on screen retains it.
   */
  gc(options: { keepEpochs?: number } = {}): number {
    const { keepEpochs } = options;
    let dropped = 0;
    for (const key of [...this.records.keys()]) {
      if (this.retainCounts.has(key)) continue;
      if (keepEpochs != null && this.epoch - (this.lastActive.get(key) ?? 0) < keepEpochs) continue;
      this.records.delete(key);
      this.lastActive.delete(key);
      dropped++;
    }
    if (dropped > 0) this.bump();
    return dropped;
  }

  hasRecord(ref: GraphRef): boolean {
    return this.records.has(this.recordKey(ref));
  }

  /** Mark a key most-recently-used (Map keeps insertion order; re-insert to bump). No-op when unbounded. */
  private touch(key: string): void {
    if (!this.maxRecords) return;
    const rec = this.records.get(key);
    if (rec) {
      this.records.delete(key);
      this.records.set(key, rec);
    }
  }

  /**
   * Evict least-recently-used records past the cap (Map's first key is the
   * oldest), skipping retained records — a record someone on screen reads is
   * never the eviction victim, even if it's the coldest. If retained records
   * alone exceed the cap, the cache temporarily runs over it.
   */
  private evict(): void {
    if (!this.maxRecords) return;
    let over = this.records.size - this.maxRecords;
    if (over <= 0) return;
    for (const key of [...this.records.keys()]) {
      if (over <= 0) break;
      if (this.retainCounts.has(key)) continue;
      this.records.delete(key);
      over--;
    }
  }

  /** Get-or-create the record map for a storage key. */
  private ensureRecord(key: string): Map<string, FieldValue> {
    this.stamp(key); // every write is activity
    let rec = this.records.get(key);
    if (!rec) {
      rec = new Map();
      this.records.set(key, rec);
    } else {
      this.touch(key);
    }
    return rec;
  }

  getField(ref: GraphRef, fieldKey: string): FieldLookup {
    const key = this.recordKey(ref);
    const rec = this.records.get(key);
    if (rec && rec.has(fieldKey)) {
      this.touch(key); // a read marks the record recently-used (LRU)
      this.stamp(key); // ...and current-generation (staleness-aware gc)
      return { status: "ready", value: rec.get(fieldKey) };
    }
    return { status: "missing" };
  }

  setField(ref: GraphRef, fieldKey: string, value: FieldValue): void {
    const key = this.recordKey(ref);
    this.ensureRecord(key).set(fieldKey, value);
    this.bumpRecord(key, fieldKey);
    this.evict();
    this.bump();
  }

  /** Merge a flat record of fields into the entity/path record. */
  merge(ref: GraphRef, fields: Readonly<Record<string, FieldValue>>): void {
    const key = this.recordKey(ref);
    const rec = this.ensureRecord(key);
    for (const [k, v] of Object.entries(fields)) {
      rec.set(k, v);
      this.bumpField(key, k);
    }
    this.bumpRecord(key);
    this.evict();
    this.bump();
  }

  /** Drop a whole record (mutation invalidation). */
  invalidate(ref: GraphRef): void {
    const key = this.recordKey(ref);
    // Bump every field a reader might have tracked before dropping it, so field-level
    // trackers re-render (the data is gone → the next read re-fetches).
    for (const fieldKey of this.records.get(key)?.keys() ?? []) this.bumpField(key, fieldKey);
    this.records.delete(key);
    this.bumpRecord(key);
    this.bump();
  }

  /** Drop a single field so the next read re-fetches it. */
  invalidateField(ref: GraphRef, fieldKey: string): void {
    const key = this.recordKey(ref);
    this.records.get(key)?.delete(fieldKey);
    this.bumpRecord(key, fieldKey);
    this.bump();
  }

  /**
   * Fold a serialized snapshot into THIS cache, field-by-field, WITHOUT replacing
   * existing records and WITHOUT notifying. Returns whether anything was
   * added/changed. The caller decides when to `notify()` — so a render-phase merge
   * can write records (visible to synchronous reads) yet defer the subscriber bump
   * to a commit-phase effect. Idempotent: re-absorbing the same snapshot is a no-op.
   */
  absorbRecords(snapshot: Record<string, Record<string, FieldValue>>): boolean {
    let changed = false;
    for (const [key, fields] of Object.entries(snapshot)) {
      const rec = this.ensureRecord(key);
      let recordChanged = false;
      for (const [k, v] of Object.entries(fields)) {
        if (!rec.has(k) || rec.get(k) !== v) {
          rec.set(k, v);
          this.bumpField(key, k);
          recordChanged = true;
        }
      }
      if (recordChanged) {
        this.bumpRecord(key); // version bumps now; the caller decides when to notify()
        changed = true;
      }
    }
    this.evict();
    return changed;
  }

  /** Serialize the whole cache (for hydration). */
  snapshot(): Record<string, Record<string, FieldValue>> {
    const out: Record<string, Record<string, FieldValue>> = {};
    for (const [key, rec] of this.records) out[key] = Object.fromEntries(rec);
    return out;
  }

  static fromSnapshot(snapshot: Record<string, Record<string, FieldValue>>, maxRecords?: number): GraphCache {
    const cache = new GraphCache(maxRecords);
    for (const [key, rec] of Object.entries(snapshot)) {
      cache.records.set(key, new Map(Object.entries(rec)));
    }
    cache.evict();
    return cache;
  }
}
