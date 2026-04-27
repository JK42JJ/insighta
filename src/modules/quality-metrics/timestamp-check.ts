/**
 * M3: Timestamp Quality Check — measures whether atom timestamps
 * are real (derived from actual video segments) or fabricated.
 *
 * Uniformity detection uses coefficient of variation (CV) on non-null
 * timestamp intervals.  CV < 0.1 → uniform_fake, regardless of whether
 * some atoms have null timestamps.
 */

const MIN_NON_NULL_FOR_UNIFORMITY = 3;
const UNIFORMITY_CV_THRESHOLD = 0.1;

export type TimestampPattern =
  | 'all_null'
  | 'uniform_fake'
  | 'mixed'
  | 'real'
  | 'insufficient'
  | 'no_atoms';

export interface TimestampCheckResult {
  nullRatio: number;
  pattern: TimestampPattern;
}

export function checkTimestamps(
  atoms: Array<{ timestamp_sec?: number | null }> | undefined
): TimestampCheckResult {
  if (!atoms || atoms.length === 0) {
    return { nullRatio: 1, pattern: 'no_atoms' };
  }

  const nullCount = atoms.filter((a) => a.timestamp_sec == null).length;
  const nullRatio = nullCount / atoms.length;

  if (nullCount === atoms.length) {
    return { nullRatio: 1, pattern: 'all_null' };
  }

  const nonNullTs = atoms
    .map((a) => a.timestamp_sec)
    .filter((ts): ts is number => ts != null)
    .sort((a, b) => a - b);

  if (nonNullTs.length < MIN_NON_NULL_FOR_UNIFORMITY) {
    return { nullRatio, pattern: 'insufficient' };
  }

  const intervals: number[] = [];
  for (let i = 1; i < nonNullTs.length; i++) {
    intervals.push(nonNullTs[i]! - nonNullTs[i - 1]!);
  }

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const isUniform = mean > 0 && coefficientOfVariation(intervals, mean) < UNIFORMITY_CV_THRESHOLD;

  if (isUniform) {
    return { nullRatio, pattern: 'uniform_fake' };
  }

  return { nullRatio, pattern: nullCount > 0 ? 'mixed' : 'real' };
}

function coefficientOfVariation(values: number[], mean: number): number {
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}
