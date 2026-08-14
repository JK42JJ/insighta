/**
 * Discover never-zero floor (P0 2026-07-11, kapasi 0-card mode).
 *
 * v3 runTier2 is fail-closed: when the mandala-filter gate drops EVERY
 * candidate, scored=[] -> slots=[] -> executor returns "No recommendations"
 * -> step3 skipped -> the user sees 0 cards even though search DID find
 * candidates (kapasi 87960287: 108 found, shorts -59, lang -6, gate input 10,
 * center-gate -8 -> 0). Design principle (embedding-async-decouple doc,
 * James): "덜 정렬된 카드 > 카드 0장" — a thin, less-ordered serve beats an
 * empty mandala.
 *
 * DISCOVER_NEVER_ZERO_FLOOR: when on AND the gate output is empty AND
 * filterable candidates exist, admit the top-N candidates (search-rank order,
 * shorts/lang/quality gates ALREADY applied upstream — the floor only bypasses
 * the center/jaccard RANKING gate, never the safety gates). Unset = current
 * fail-closed behavior (flag alone rolls back).
 *
 * DISCOVER_ZERO_FLOOR_MAX: cap on floor-admitted candidates (default 16 =
 * 2 per cell) — enough to not look broken, small enough that async relevance
 * backfill re-ranks a mostly-unordered set quickly.
 */
const DEFAULT_ZERO_FLOOR_MAX = 16;

export function isDiscoverNeverZeroFloorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['DISCOVER_NEVER_ZERO_FLOOR'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export function getZeroFloorMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['DISCOVER_ZERO_FLOOR_MAX']);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_ZERO_FLOOR_MAX;
}
