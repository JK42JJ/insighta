/**
 * Timeline range validator for v2 segments (CP488+ Phase 1.5, 2026-05-27).
 *
 * Rejects LLM outputs whose `sections.last.to_sec` or
 * `atoms.max(timestamp_sec)` clearly hallucinate past the actual video
 * duration. Sits behind the existing `validateV2Layered` (shape check)
 * and `scoreCompleteness` (completeness) — runs ONLY when the row has
 * a known `duration_seconds` from `youtube_videos`.
 *
 * Tolerance: 5% over duration. Real captions occasionally extend a
 * second or two past the wall-clock duration; we don't want to fail
 * on those. But Phase 3 dogfooding showed Sonnet 4.6 producing
 * `to_sec = 1380` against `duration = 901` (53% over-shoot) — well
 * outside any plausible rounding band.
 *
 * Design: docs/design/v2-quality-audit-system-2026-05-27.md §8
 * (smoke-gate spec) + retroactive learning from Phase 3 dogfood.
 */

const OVER_SHOOT_TOLERANCE = 1.05;

export class V2TimelineRangeError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly observed: number,
    public readonly maxAllowed: number
  ) {
    super(message);
    this.name = 'V2TimelineRangeError';
  }
}

export interface TimelineCheckInput {
  durationSeconds: number;
  sections?: Array<{ to_sec?: number }>;
  atoms?: Array<{ timestamp_sec?: number | null }>;
}

/**
 * Pure-function range check. Throws `V2TimelineRangeError` on the
 * first violation it finds (caller's loop treats this as a retry
 * reason). Returns silently if the row passes or if duration is
 * unknown / non-positive (in which case the audit metrics handle
 * detection downstream).
 */
export function validateV2TimelineRange(input: TimelineCheckInput): void {
  const { durationSeconds } = input;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return;
  }
  const maxAllowed = Math.ceil(durationSeconds * OVER_SHOOT_TOLERANCE);

  if (input.sections && input.sections.length > 0) {
    const last = input.sections[input.sections.length - 1];
    const toSec = typeof last?.to_sec === 'number' ? last.to_sec : null;
    if (toSec != null && toSec > maxAllowed) {
      throw new V2TimelineRangeError(
        `sections.last.to_sec=${toSec} exceeds duration=${durationSeconds} (cap=${maxAllowed} with 5% tolerance)`,
        'segments.sections.last.to_sec',
        toSec,
        maxAllowed
      );
    }
  }

  if (input.atoms && input.atoms.length > 0) {
    const stamps = input.atoms
      .map((a) => a?.timestamp_sec)
      .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
    if (stamps.length > 0) {
      const maxTs = Math.max(...stamps);
      if (maxTs > maxAllowed) {
        throw new V2TimelineRangeError(
          `atoms.max(timestamp_sec)=${maxTs} exceeds duration=${durationSeconds} (cap=${maxAllowed} with 5% tolerance)`,
          'segments.atoms[].timestamp_sec',
          maxTs,
          maxAllowed
        );
      }
    }
  }
}
