/**
 * v2 Quality Audit metrics (CP488+, 2026-05-27).
 *
 * Pure-function scoring for the daily audit cron. No I/O — accepts a
 * normalized `AuditInput` and returns 8 metric scores + an overall score
 * + a violation list. Caller (the cron worker) is responsible for
 * extracting the input from `video_rich_summaries.segments` / `core` and
 * `youtube_videos.duration_seconds`.
 *
 * Design: docs/design/v2-quality-audit-system-2026-05-27.md §3.
 *
 * Score conventions:
 * - Each metric returns 0–100 or null (null = "cannot compute, input missing").
 * - `overall` = simple average of non-null metric scores, rounded to int.
 * - `violations` = metrics that scored below the warning threshold passed
 *   in (default 70). Caller decides what to do with them.
 */

const ONE_LINER_GOOD_MAX = 20; // ≤20 chars = 100
const ONE_LINER_BAD_MAX = 30; // ≥30 chars = 0
const COVERAGE_START_GOOD_MAX_SEC = 60; // first section must start ≤60s in
const COVERAGE_START_BAD_MAX_SEC = 180; // ≥180s start = 0

export interface AuditInputSection {
  from_sec: number;
  to_sec: number;
}

export interface AuditInputAtom {
  timestamp_sec?: number | null;
}

export interface AuditInput {
  videoId: string;
  durationSeconds: number | null | undefined;
  oneliner?: string | null;
  sections?: AuditInputSection[] | null;
  atoms?: AuditInputAtom[] | null;
}

export interface AuditViolation {
  metric: string;
  score: number;
  detail: string;
}

export interface AuditScore {
  overall: number;
  m1RangeFit: number | null;
  m2CoverageStart: number | null;
  m3CoverageEnd: number | null;
  m4AtomsRange: number | null;
  m5AtomsDistribution: number | null;
  m6AtomsSorted: number | null;
  m7SectionsGap: number | null;
  m8OneLinerLen: number | null;
  violations: AuditViolation[];
}

/**
 * Linearly map a value in [good, bad] → [100, 0]. Clamps outside the
 * range. Used for "smaller is better" metrics like coverage start time.
 */
function smallerIsBetter(value: number, good: number, bad: number): number {
  if (value <= good) return 100;
  if (value >= bad) return 0;
  const t = (value - good) / (bad - good);
  return Math.round((1 - t) * 100);
}

/**
 * Compute M1 Range fit: how closely the last section's to_sec matches
 * the actual duration. Sweet spot 0.95–1.05 = 100; further off, the
 * score drops linearly to 0 at 0.5 or 1.5.
 */
export function computeM1RangeFit(input: AuditInput): number | null {
  const duration = input.durationSeconds;
  const sections = input.sections;
  if (!duration || duration <= 0 || !sections || sections.length === 0) return null;
  const lastTo = sections[sections.length - 1]?.to_sec;
  if (lastTo == null || lastTo < 0) return null;
  const ratio = lastTo / duration;
  // Sweet spot 0.95–1.05
  if (ratio >= 0.95 && ratio <= 1.05) return 100;
  // 0 at ratio ≤ 0.5 (massive under-coverage) or ratio ≥ 1.5 (massive over-shoot)
  if (ratio <= 0.5 || ratio >= 1.5) return 0;
  const distance = ratio < 0.95 ? 0.95 - ratio : ratio - 1.05;
  const maxDistance = ratio < 0.95 ? 0.95 - 0.5 : 1.5 - 1.05;
  return Math.round((1 - distance / maxDistance) * 100);
}

/**
 * Compute M2 Coverage start: does the first section start at/near 0:00?
 * ≤60s = 100, 180s+ = 0, linear in between.
 */
export function computeM2CoverageStart(input: AuditInput): number | null {
  const sections = input.sections;
  if (!sections || sections.length === 0) return null;
  const first = sections[0];
  if (!first || first.from_sec == null || first.from_sec < 0) return null;
  return smallerIsBetter(first.from_sec, COVERAGE_START_GOOD_MAX_SEC, COVERAGE_START_BAD_MAX_SEC);
}

/**
 * Compute M3 Coverage end: how far the last section's to_sec misses the
 * actual duration, expressed as fraction of duration. -5%..+5% = 100.
 */
export function computeM3CoverageEnd(input: AuditInput): number | null {
  const duration = input.durationSeconds;
  const sections = input.sections;
  if (!duration || duration <= 0 || !sections || sections.length === 0) return null;
  const lastTo = sections[sections.length - 1]?.to_sec;
  if (lastTo == null) return null;
  const diffFraction = (duration - lastTo) / duration; // positive = under-coverage
  const absDiff = Math.abs(diffFraction);
  if (absDiff <= 0.05) return 100;
  if (absDiff >= 0.5) return 0;
  return Math.round((1 - (absDiff - 0.05) / 0.45) * 100);
}

/**
 * Compute M4 Atoms range fit: ratio of max(atom.timestamp_sec) to
 * duration. 0.85–1.05 = 100. Below 0.85 = atoms only cover early
 * portion (hallucination pattern); above 1.05 = atoms time-stamped
 * past the actual end of video.
 */
export function computeM4AtomsRange(input: AuditInput): number | null {
  const duration = input.durationSeconds;
  const atoms = input.atoms;
  if (!duration || duration <= 0 || !atoms || atoms.length === 0) return null;
  const timestamps = atoms
    .map((a) => a.timestamp_sec)
    .filter((t): t is number => typeof t === 'number' && t >= 0);
  if (timestamps.length === 0) return null;
  const maxTs = Math.max(...timestamps);
  const ratio = maxTs / duration;
  if (ratio >= 0.85 && ratio <= 1.05) return 100;
  if (ratio <= 0.3 || ratio >= 1.5) return 0;
  const distance = ratio < 0.85 ? 0.85 - ratio : ratio - 1.05;
  const maxDistance = ratio < 0.85 ? 0.85 - 0.3 : 1.5 - 1.05;
  return Math.round((1 - distance / maxDistance) * 100);
}

/**
 * Compute M5 Atoms distribution: stddev of atom timestamps divided by
 * (duration/2). A uniform distribution gives ~0.5; bunched atoms give
 * a small stddev. Sweet spot 0.4–0.6 = 100.
 */
export function computeM5AtomsDistribution(input: AuditInput): number | null {
  const duration = input.durationSeconds;
  const atoms = input.atoms;
  if (!duration || duration <= 0 || !atoms || atoms.length === 0) return null;
  const timestamps = atoms
    .map((a) => a.timestamp_sec)
    .filter((t): t is number => typeof t === 'number' && t >= 0);
  if (timestamps.length < 3) return null;
  const mean = timestamps.reduce((s, v) => s + v, 0) / timestamps.length;
  const variance = timestamps.reduce((s, v) => s + (v - mean) * (v - mean), 0) / timestamps.length;
  const stddev = Math.sqrt(variance);
  const normalized = stddev / (duration / 2);
  if (normalized >= 0.4 && normalized <= 0.6) return 100;
  if (normalized <= 0.1 || normalized >= 1.0) return 0;
  const distance = normalized < 0.4 ? 0.4 - normalized : normalized - 0.6;
  const maxDistance = normalized < 0.4 ? 0.4 - 0.1 : 1.0 - 0.6;
  return Math.round((1 - distance / maxDistance) * 100);
}

/**
 * Compute M6 Atoms sorted: are atom timestamps ascending? 100 if yes,
 * 0 if any out-of-order pair exists. Atoms without timestamp_sec are
 * skipped (they cannot be unsorted).
 */
export function computeM6AtomsSorted(input: AuditInput): number | null {
  const atoms = input.atoms;
  if (!atoms || atoms.length === 0) return null;
  const timestamps = atoms
    .map((a) => a.timestamp_sec)
    .filter((t): t is number => typeof t === 'number' && t >= 0);
  if (timestamps.length < 2) return null;
  for (let i = 1; i < timestamps.length; i += 1) {
    if ((timestamps[i] as number) < (timestamps[i - 1] as number)) return 0;
  }
  return 100;
}

/**
 * Compute M7 Sections gap: sum of gaps between consecutive sections,
 * expressed as fraction of duration. 0% = 100, 5%+ = 0. Negative gaps
 * (overlap) also penalised.
 */
export function computeM7SectionsGap(input: AuditInput): number | null {
  const duration = input.durationSeconds;
  const sections = input.sections;
  if (!duration || duration <= 0 || !sections || sections.length < 2) return null;
  let totalGap = 0;
  for (let i = 1; i < sections.length; i += 1) {
    const prev = sections[i - 1];
    const curr = sections[i];
    if (!prev || !curr) continue;
    const gap = curr.from_sec - prev.to_sec; // positive = gap, negative = overlap
    totalGap += Math.abs(gap);
  }
  const fraction = totalGap / duration;
  if (fraction <= 0.001) return 100;
  if (fraction >= 0.05) return 0;
  return Math.round((1 - (fraction - 0.001) / (0.05 - 0.001)) * 100);
}

/**
 * Compute M8 One-liner length: ≤20 chars = 100, ≥30 chars = 0,
 * linear in between.
 */
export function computeM8OneLinerLen(input: AuditInput): number | null {
  const oneliner = input.oneliner;
  if (oneliner == null) return null;
  const len = oneliner.trim().length;
  if (len === 0) return 0;
  return smallerIsBetter(len, ONE_LINER_GOOD_MAX, ONE_LINER_BAD_MAX);
}

/**
 * Compute all 8 metrics + overall score + violation list.
 *
 * @param input — normalized audit input
 * @param warningThreshold — scores strictly below this register as a violation.
 *   The cron passes `config.warningScore` (default 70).
 */
export function computeAuditScore(input: AuditInput, warningThreshold = 70): AuditScore {
  const m1 = computeM1RangeFit(input);
  const m2 = computeM2CoverageStart(input);
  const m3 = computeM3CoverageEnd(input);
  const m4 = computeM4AtomsRange(input);
  const m5 = computeM5AtomsDistribution(input);
  const m6 = computeM6AtomsSorted(input);
  const m7 = computeM7SectionsGap(input);
  const m8 = computeM8OneLinerLen(input);

  const computed: Array<{ name: string; score: number }> = [];
  const collect = (name: string, score: number | null) => {
    if (score != null) computed.push({ name, score });
  };
  collect('m1_range_fit', m1);
  collect('m2_coverage_start', m2);
  collect('m3_coverage_end', m3);
  collect('m4_atoms_range', m4);
  collect('m5_atoms_distribution', m5);
  collect('m6_atoms_sorted', m6);
  collect('m7_sections_gap', m7);
  collect('m8_oneliner_len', m8);

  const overall =
    computed.length === 0
      ? 0
      : Math.round(computed.reduce((s, m) => s + m.score, 0) / computed.length);

  const violations: AuditViolation[] = computed
    .filter((m) => m.score < warningThreshold)
    .map((m) => ({
      metric: m.name,
      score: m.score,
      detail: explainViolation(m.name, input),
    }));

  return {
    overall,
    m1RangeFit: m1,
    m2CoverageStart: m2,
    m3CoverageEnd: m3,
    m4AtomsRange: m4,
    m5AtomsDistribution: m5,
    m6AtomsSorted: m6,
    m7SectionsGap: m7,
    m8OneLinerLen: m8,
    violations,
  };
}

function explainViolation(metric: string, input: AuditInput): string {
  const dur = input.durationSeconds ?? 0;
  switch (metric) {
    case 'm1_range_fit': {
      const lastTo = input.sections?.[input.sections.length - 1]?.to_sec ?? 0;
      return `sections.last.to_sec=${lastTo} vs duration=${dur}`;
    }
    case 'm2_coverage_start': {
      const first = input.sections?.[0]?.from_sec ?? 0;
      return `sections.first.from_sec=${first}`;
    }
    case 'm3_coverage_end': {
      const lastTo = input.sections?.[input.sections.length - 1]?.to_sec ?? 0;
      return `duration - last.to_sec = ${dur - lastTo}`;
    }
    case 'm4_atoms_range': {
      const ts = (input.atoms ?? [])
        .map((a) => a.timestamp_sec)
        .filter((t): t is number => typeof t === 'number');
      const maxTs = ts.length > 0 ? Math.max(...ts) : 0;
      return `atoms.max(timestamp_sec)=${maxTs} vs duration=${dur}`;
    }
    case 'm5_atoms_distribution':
      return 'atom timestamps bunched (low stddev)';
    case 'm6_atoms_sorted':
      return 'atom timestamps not monotonically ascending';
    case 'm7_sections_gap':
      return 'sections do not tile the timeline end-to-end';
    case 'm8_oneliner_len': {
      const len = (input.oneliner ?? '').trim().length;
      return `one_liner length=${len} chars`;
    }
    default:
      return '';
  }
}

/**
 * Classify an overall score into one of three buckets — used by the cron
 * to decide regen-queue enqueuing and admin dashboard styling.
 */
export type AuditClassification = 'pass' | 'warning' | 'critical';

export function classifyScore(
  overall: number,
  passThreshold: number,
  warningThreshold: number
): AuditClassification {
  if (overall >= passThreshold) return 'pass';
  if (overall >= warningThreshold) return 'warning';
  return 'critical';
}
