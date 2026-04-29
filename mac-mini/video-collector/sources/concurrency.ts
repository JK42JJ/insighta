/**
 * Bounded-concurrency mapper — preserves input order in the output array.
 *
 * Used to parallelize per-keyword yt-dlp searches in S2 and S4 (CP438).
 * yt-dlp via WebShare proxy uses one rotation slot per call; with
 * `WEBSHARE_ROTATION_MAX` ≥ concurrency, parallel calls each draw a
 * different slot and avoid per-IP rate-limits.
 */

export async function pConcurrencyMap<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
