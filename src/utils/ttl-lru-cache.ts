/**
 * TtlLruCache — a small bounded cache with per-entry TTL + LRU eviction.
 *
 * CP499 — extracted so the goal-embed cache (search.ts) is unit-testable
 * without the network: the embed is goal-deterministic, so caching the
 * (goal-string → vector) result safely collapses the multiple independent
 * callers (FE search + server merged-gen + manual retries) into one embed.
 *
 * `now` is injectable so tests can drive TTL expiry deterministically without
 * fake timers.
 */
export class TtlLruCache<K, V> {
  private readonly map = new Map<K, { value: V; expires: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Returns the live value, or undefined on miss/expiry. A hit refreshes LRU order. */
  get(key: K): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    // LRU touch: re-insert so this key becomes the most-recently-used.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  /** Store value with a fresh TTL; evict the oldest entry when over capacity. */
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
