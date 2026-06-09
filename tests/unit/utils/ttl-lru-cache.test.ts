/**
 * TtlLruCache — hit / miss / TTL expiry / LRU eviction (CP499).
 * Clock is injected so TTL is deterministic without fake timers.
 */
import { TtlLruCache } from '../../../src/utils/ttl-lru-cache';

describe('TtlLruCache', () => {
  test('miss then hit returns the stored value', () => {
    const c = new TtlLruCache<string, number[]>(4, 1000, () => 0);
    expect(c.get('a')).toBeUndefined();
    c.set('a', [1, 2, 3]);
    expect(c.get('a')).toEqual([1, 2, 3]);
  });

  test('TTL expiry: entry is gone once now passes expires', () => {
    let t = 0;
    const c = new TtlLruCache<string, number>(4, 1000, () => t);
    c.set('a', 1);
    t = 999;
    expect(c.get('a')).toBe(1); // still live
    t = 1000;
    expect(c.get('a')).toBeUndefined(); // expired (expires <= now)
  });

  test('LRU eviction: oldest goes when over capacity', () => {
    const c = new TtlLruCache<string, number>(2, 10_000, () => 0);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3); // evicts 'a' (oldest)
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });

  test('a get() refreshes LRU order so the touched key survives', () => {
    const c = new TtlLruCache<string, number>(2, 10_000, () => 0);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // touch 'a' → 'b' is now oldest
    c.set('c', 3); // evicts 'b', not 'a'
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });

  test('set on an existing key refreshes value + TTL', () => {
    let t = 0;
    const c = new TtlLruCache<string, number>(4, 1000, () => t);
    c.set('a', 1);
    t = 500;
    c.set('a', 2); // refresh → expires at 1500
    t = 1200;
    expect(c.get('a')).toBe(2); // would have expired at 1000 if not refreshed
  });
});
