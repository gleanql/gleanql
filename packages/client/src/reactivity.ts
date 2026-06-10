import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { GraphCache } from "./cache.js";
import type { GraphRuntime } from "./runtime.js";

/**
 * Fine-grained re-render substrate (valtio-style).
 *
 * A component tracks the records it read this render; its `useSyncExternalStore`
 * snapshot is gated by a digest of just those records' versions, so a global cache
 * notify only re-renders the components whose records actually changed — no per-key
 * subscription fan-out. The hooks in `glue-client.ts` drive this: `useGlean` installs
 * an ambient read tracker, `usePaginated` seeds the set with its connection's record.
 */

/** A stable digest of the tracked keys' versions; changes iff a tracked key changed.
 * Each key is resolved at its own granularity — a field (`record\0field`, from
 * `useGlean`) or a whole record (from `usePaginated`) — via {@link GraphCache.trackedVersion}. */
export function affectedDigest(cache: GraphCache, keys: ReadonlySet<string>): string {
  if (keys.size === 0) return "";
  let out = "";
  for (const key of keys) out += `${key}:${cache.trackedVersion(key)}|`;
  return out;
}

/**
 * Re-render the caller only when one of the records in `affected.current` changes.
 * The external snapshot is a monotonic counter (stable during render, decoupled from
 * the live set) so it never spuriously diverges from the render-time value; the
 * subscriber bumps it only when the digest actually changed, and an effect rebases the
 * baseline to this render's reads. SSR is a no-op (`getServerSnapshot` → 0).
 */
export function useFineGrainedRerender(
  runtime: GraphRuntime | undefined,
  affected: { current: Set<string> },
): void {
  const tick = useRef(0);
  const baseline = useRef("");
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!runtime) return () => {};
      const cache = runtime.cache;
      baseline.current = affectedDigest(cache, affected.current); // rebase at (re)subscribe
      return cache.subscribe(() => {
        const next = affectedDigest(cache, affected.current);
        if (next !== baseline.current) {
          baseline.current = next;
          tick.current++;
          onChange();
        }
      });
    },
    [runtime, affected],
  );
  useSyncExternalStore(subscribe, () => tick.current, () => 0);
  // Post-commit: rebase to THIS render's reads + current versions, so the next notify
  // compares against the records actually read this pass (they can differ per render).
  useEffect(() => {
    if (runtime) baseline.current = affectedDigest(runtime.cache, affected.current);
  });
}

/**
 * Diff this render's tracked keys against the currently-held retentions:
 * retain newly-read records, release ones no longer read. `held` maps record
 * key → its release. Pure cache+map logic (the React hook is a thin effect
 * shell over it), so it's directly unit-testable.
 */
export function syncRetention(cache: GraphCache, held: Map<string, () => void>, tracked: ReadonlySet<string>): void {
  const current = new Set<string>();
  for (const key of tracked) current.add(cache.trackedRecordKey(key));
  for (const key of current) {
    if (!held.has(key)) held.set(key, cache.retain(key));
  }
  for (const [key, release] of held) {
    if (!current.has(key)) {
      release();
      held.delete(key);
    }
  }
}

/** Release every held retention (unmount). */
export function releaseRetention(held: Map<string, () => void>): void {
  for (const release of held.values()) release();
  held.clear();
}

/**
 * Retain this render's records while mounted (reference-counted, Relay-style):
 * post-commit, the records the component read are pinned — `cache.gc()` and LRU
 * eviction skip them — and released when the component stops reading them or
 * unmounts.
 */
function useRetained(runtime: GraphRuntime | undefined, affected: { current: Set<string> }): void {
  const held = useRef<Map<string, () => void>>(new Map());
  useEffect(() => {
    if (runtime) syncRetention(runtime.cache, held.current, affected.current);
  });
  useEffect(() => {
    const map = held.current;
    return () => releaseRetention(map);
  }, []);
}

/**
 * Translate a render's tracked keys into masked-read violations: field-level
 * reads on IDENTIFIED records whose `Type.field` pair is outside the
 * component's compiled read-map. Record-level trackers and path-identity
 * records carry no typename — skipped, never guessed.
 */
export function maskViolations(
  cache: GraphCache,
  allowed: ReadonlySet<string>,
  tracked: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const key of tracked) {
    const record = cache.trackedRecordKey(key);
    if (record === key) continue; // record-level tracker — not a field read
    if (record.startsWith("path:")) continue; // id-less record — typename unknown
    const pair = `${record.slice(0, record.indexOf(":"))}.${key.slice(record.length + 1)}`;
    if (!allowed.has(pair)) out.push(pair);
  }
  return out;
}

/**
 * The shared shape of the tracking hooks: hold a per-render "affected records" set,
 * let the caller `populate` it (install an ambient tracker, or seed a known record),
 * and wire fine-grained re-rendering over it. `populate` runs synchronously in the
 * hook body, so reads that follow in the component attribute to this render's set.
 * While mounted, the records read are retained (see {@link useRetained});
 * `onCommit` (if given) sees the final set post-commit — the masking check.
 */
export function useTracked(
  runtime: GraphRuntime | undefined,
  populate: (affected: Set<string>) => void,
  onCommit?: (tracked: ReadonlySet<string>) => void,
): void {
  const affected = useRef<Set<string>>(new Set());
  const tracking = new Set<string>();
  populate(tracking);
  affected.current = tracking;
  useFineGrainedRerender(runtime, affected);
  useRetained(runtime, affected);
  useEffect(() => {
    onCommit?.(affected.current);
  });
}
