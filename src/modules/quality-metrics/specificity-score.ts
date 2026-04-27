/**
 * Specificity Score — combined M1 + M3 quality metric.
 * Weights: M1 (title overlap) = 0.55, M3 (timestamp quality) = 0.45
 */

import { measureTitleOverlap, extractContentTexts } from './title-overlap';
import {
  checkTimestamps,
  type TimestampCheckResult,
  type TimestampPattern,
} from './timestamp-check';

const M1_WEIGHT = 0.55;
const M3_WEIGHT = 0.45;

export interface SpecificityResult {
  m1TitleOverlap: number;
  m3TimestampNullRatio: number;
  m3TimestampPattern: TimestampPattern;
  specificityScore: number | null; // null if not enough data
}

/**
 * Convert a TimestampCheckResult into a [0, 1] score.
 * uniform_fake = 0 (timestamps exist but are fabricated).
 * real = 1 (timestamps are varied, likely genuine).
 * mixed = complement of null ratio.
 * insufficient = 0.25 (too few non-null to judge confidently).
 * all_null / no_atoms = 0.
 */
function timestampPatternScore(result: TimestampCheckResult): number {
  if (result.pattern === 'uniform_fake') return 0;
  if (result.pattern === 'real') return 1;
  if (result.pattern === 'mixed') return 1 - result.nullRatio;
  if (result.pattern === 'insufficient') return 0.25;
  // all_null or no_atoms
  return 0;
}

/**
 * Compute M1 + M3 specificity for a single summary.
 *
 * @param title - Video title used for M1 calculation
 * @param structured - Parsed JSON from video_rich_summaries.structured (null-safe)
 * @returns SpecificityResult, or null if structured is empty/null
 */
export function computeSpecificity(
  title: string,
  structured: Record<string, unknown> | null
): SpecificityResult | null {
  if (!structured || Object.keys(structured).length === 0) return null;

  // M1: Title overlap
  const contentTexts = extractContentTexts(structured);
  const m1 = measureTitleOverlap(title, contentTexts);

  // M3: Timestamp check (V2 only — atoms array)
  const atoms = structured['atoms'] as Array<{ timestamp_sec?: number | null }> | undefined;
  const m3Result = checkTimestamps(atoms);

  const hasAtoms = Array.isArray(atoms) && atoms.length > 0;

  let specificityScore: number | null;
  if (hasAtoms) {
    const m3Score = timestampPatternScore(m3Result);
    specificityScore = m1 * M1_WEIGHT + m3Score * M3_WEIGHT;
  } else {
    // V1: only M1 applies; score equals M1 alone
    specificityScore = m1;
  }

  return {
    m1TitleOverlap: m1,
    m3TimestampNullRatio: m3Result.nullRatio,
    m3TimestampPattern: m3Result.pattern,
    specificityScore,
  };
}
