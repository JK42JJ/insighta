/**
 * M3: Timestamp Quality Check — measures whether atom timestamps
 * are real (derived from actual video segments) or fabricated.
 */

/** Maximum deviation from average interval to still be considered "uniform" (seconds). */
const UNIFORM_TOLERANCE_SEC = 5;

export type TimestampPattern = 'all_null' | 'uniform_fake' | 'real' | 'mixed' | 'no_atoms';

export interface TimestampCheckResult {
  nullRatio: number;
  pattern: TimestampPattern;
}

/**
 * Inspect atom timestamps and classify their pattern.
 *
 * @param atoms - Array of atoms from a V2 structured summary (undefined = V1 / no atoms)
 * @returns null ratio (0–1) and a pattern classification
 */
export function checkTimestamps(
  atoms: Array<{ timestamp_sec?: number | null }> | undefined
): TimestampCheckResult {
  if (!atoms || atoms.length === 0) {
    return { nullRatio: 1, pattern: 'no_atoms' };
  }

  const nullCount = atoms.filter((a) => a.timestamp_sec == null).length;
  const nullRatio = nullCount / atoms.length;

  // All null
  if (nullCount === atoms.length) {
    return { nullRatio: 1, pattern: 'all_null' };
  }

  // Mixed (some null, some not)
  if (nullCount > 0) {
    return { nullRatio, pattern: 'mixed' };
  }

  // All have timestamps — check if uniform (fake) or varied (real)
  const timestamps = atoms.map((a) => a.timestamp_sec!).sort((a, b) => a - b);

  if (timestamps.length < 2) {
    return { nullRatio: 0, pattern: 'real' }; // single atom, cannot determine uniformity
  }

  // Calculate intervals between consecutive timestamps
  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const prev = timestamps[i - 1] ?? 0;
    const curr = timestamps[i] ?? 0;
    intervals.push(curr - prev);
  }

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const isUniform = intervals.every((iv) => Math.abs(iv - avgInterval) <= UNIFORM_TOLERANCE_SEC);

  return {
    nullRatio: 0,
    pattern: isUniform ? 'uniform_fake' : 'real',
  };
}
