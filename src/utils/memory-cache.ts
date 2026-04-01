/**
 * Generic in-memory cache with TTL and bounded size.
 *
 * Usage:
 *   const cache = new MemoryCache<MyType>({ defaultTTLMs: 600_000, maxEntries: 100 });
 *   cache.set('key', data);
 *   const hit = cache.get('key'); // MyType | null
 */

export interface MemoryCacheOptions {
  /** Default TTL in milliseconds */
  defaultTTLMs: number;
  /** Maximum number of entries. Oldest evicted when exceeded. 0 = unlimited. */
  maxEntries?: number;
}

export class MemoryCache<T = unknown> {
  private store = new Map<string, { data: T; expiry: number }>();
  private readonly defaultTTLMs: number;
  private readonly maxEntries: number;

  constructor(options: MemoryCacheOptions) {
    this.defaultTTLMs = options.defaultTTLMs;
    this.maxEntries = options.maxEntries ?? 0;
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key: string, data: T, ttlMs?: number): void {
    // Evict oldest entries if at capacity
    if (this.maxEntries > 0 && this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, {
      data,
      expiry: Date.now() + (ttlMs ?? this.defaultTTLMs),
    });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  /**
   * Build a deterministic cache key from key-value pairs.
   * Sorts keys alphabetically and joins with '|' separator.
   * Undefined values are omitted.
   */
  static buildKey(parts: Record<string, string | number | undefined>): string {
    return Object.keys(parts)
      .sort()
      .filter((k) => parts[k] !== undefined)
      .map((k) => `${k}=${parts[k]}`)
      .join('|');
  }
}
