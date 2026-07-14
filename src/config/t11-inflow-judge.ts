/**
 * T11 Stage1 — inflow judge shadow (design 2026-07-14, supervisor GO).
 *
 * Post-done RACE: the unanimous 2-model judge runs fire-and-forget right
 * AFTER the precompute row is marked done — the SLA path is untouched by
 * construction (F12's cause was putting judgment ON the path). Verdicts
 * land in the DEDICATED judge_verdicts column (data-write rule: judge
 * output never touches relevance_pct).
 *
 * Stage1 = shadow: record + metrics only, placement unchanged.
 * Stage2 (enforce, separate gate): consume drops unanimous-unfit slots
 * above the per-cell floor.
 *
 * Flag default OFF (unset = no judging at all). Rollback: flag flip.
 */

export function isT11InflowJudgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['T11_INFLOW_JUDGE_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export interface CellVerdictInput {
  videoId: string;
  cellIndex: number;
  /** Unanimous verdict: false = both legs said unfit. */
  fit: boolean;
}

export interface FloorPlanResult {
  /** videoIds that WOULD be dropped in Stage2 (unfit above the floor). */
  wouldDrop: string[];
  /** unfit videoIds kept to honor the floor (marked kept-despite-unfit). */
  keptDespiteUnfit: string[];
}

/**
 * Cell-floor plan (supervisor ①): keep at least `minPerCell` cards per cell —
 * "덜 정합한 카드 > 빈 셀" (never-zero-floor principle). Only unfit cards
 * ABOVE the floor are drop candidates; when dropping would sink the cell
 * below the floor, the needed count of unfit cards is kept (and marked so
 * the relevance re-score → tone-down path can demote them visually).
 * Pure function — unit-tested; Stage1 uses it for the would-drop metric,
 * Stage2 will use it for the actual drop set.
 */
export function planCellFloor(cards: CellVerdictInput[], minPerCell: number): FloorPlanResult {
  const wouldDrop: string[] = [];
  const keptDespiteUnfit: string[] = [];
  const byCell = new Map<number, CellVerdictInput[]>();
  for (const c of cards) {
    if (!byCell.has(c.cellIndex)) byCell.set(c.cellIndex, []);
    byCell.get(c.cellIndex)!.push(c);
  }
  for (const cellCards of byCell.values()) {
    const fitCount = cellCards.filter((c) => c.fit).length;
    const unfit = cellCards.filter((c) => !c.fit);
    // How many unfit cards must stay to keep the cell at the floor.
    const mustKeep = Math.max(0, Math.min(unfit.length, minPerCell - fitCount));
    // Keep order = input order (caller passes score-descending when it matters).
    unfit.slice(0, mustKeep).forEach((c) => keptDespiteUnfit.push(c.videoId));
    unfit.slice(mustKeep).forEach((c) => wouldDrop.push(c.videoId));
  }
  return { wouldDrop, keptDespiteUnfit };
}
