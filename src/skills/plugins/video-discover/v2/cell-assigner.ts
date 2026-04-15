/**
 * video-discover v2 — cell assigner
 *
 * Pure functions that score embedded videos against per-cell sub_goal
 * embeddings (cosine) and distribute them across the 8 cells so total
 * assigned == TARGET_TOTAL (40), with TARGET_PER_CELL (5) per cell.
 *
 * Two phases:
 *   1. assign each video to its highest-scoring cell, take top N per cell
 *   2. rebalance: any cell with < N pulls candidates from videos whose
 *      score for that cell ranks 2nd / 3rd / etc.
 *
 * Even-fallback (`assignEvenly`) round-robins videos when scoring is
 * unavailable (Ollama down). Sacrifices relevance to guarantee a
 * non-empty grid.
 *
 * Caller is responsible for ensuring the input pool is large enough to
 * reach 40 (this module never invents videos).
 */

import { cosineSimilarity } from '../../iks-scorer/embedding';

export const NUM_CELLS = 8;
export const TARGET_PER_CELL = 5;
export const TARGET_TOTAL = NUM_CELLS * TARGET_PER_CELL; // 40

export interface VideoScore {
  videoId: string;
  /** Cosine similarity per cell (length === NUM_CELLS). */
  cellScores: number[];
  bestCell: number;
  bestScore: number;
}

export interface CellAssignment {
  cellIndex: number;
  /** Video IDs in score-descending order. May be empty. */
  videoIds: string[];
}

/**
 * Score every embedded video against every sub_goal embedding. Videos with
 * no embedding (not in the map) are skipped. Throws only if the sub_goal
 * embeddings array isn't exactly NUM_CELLS long (caller bug).
 */
export function scoreVideos(
  videoEmbeddings: Map<string, number[]>,
  subGoalEmbeddings: ReadonlyArray<number[]>
): VideoScore[] {
  if (subGoalEmbeddings.length !== NUM_CELLS) {
    throw new Error(
      `cell-assigner: expected ${NUM_CELLS} sub_goal embeddings, got ${subGoalEmbeddings.length}`
    );
  }
  const out: VideoScore[] = [];
  for (const [videoId, vec] of videoEmbeddings.entries()) {
    const cellScores: number[] = new Array(NUM_CELLS);
    let bestCell = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < NUM_CELLS; i++) {
      const sg = subGoalEmbeddings[i];
      if (!sg || sg.length !== vec.length) {
        cellScores[i] = -Infinity;
        continue;
      }
      const s = cosineSimilarity(vec, sg);
      cellScores[i] = s;
      if (s > bestScore) {
        bestScore = s;
        bestCell = i;
      }
    }
    out.push({ videoId, cellScores, bestCell, bestScore });
  }
  return out;
}

/**
 * Distribute scored videos across NUM_CELLS cells.
 *
 * Phase 1: bucket by `bestCell`, sort each bucket by `bestScore` desc, take
 *          top `targetPerCell`.
 * Phase 2: any cell with < targetPerCell pulls videos that ranked it 2nd /
 *          3rd / etc. (i.e. not yet used) ordered by that cell's score.
 *
 * Output: NUM_CELLS assignments. `totalAssigned()` may be < TARGET_TOTAL
 * when the pool is too small / too lopsided — caller invokes the fallback
 * strategy in that case.
 */
export function assignToCells(
  scored: VideoScore[],
  targetPerCell: number = TARGET_PER_CELL
): CellAssignment[] {
  const used = new Set<string>();
  const buckets: VideoScore[][] = Array.from({ length: NUM_CELLS }, () => []);
  for (const s of scored) {
    const b = buckets[s.bestCell];
    if (b) b.push(s);
  }

  // Phase 1: per-bucket top N by bestScore desc
  const assignments: CellAssignment[] = buckets.map((bucket, cellIndex) => {
    bucket.sort((a, b) => b.bestScore - a.bestScore);
    const taken = bucket.slice(0, targetPerCell);
    for (const v of taken) used.add(v.videoId);
    return { cellIndex, videoIds: taken.map((v) => v.videoId) };
  });

  // Phase 2: rebalance underfilled cells
  for (const a of assignments) {
    if (a.videoIds.length >= targetPerCell) continue;
    const need = targetPerCell - a.videoIds.length;
    const candidates = scored
      .filter((s) => !used.has(s.videoId))
      .map((s) => ({ videoId: s.videoId, score: s.cellScores[a.cellIndex] ?? -Infinity }))
      .filter((c) => Number.isFinite(c.score))
      .sort((x, y) => y.score - x.score)
      .slice(0, need);
    for (const c of candidates) {
      a.videoIds.push(c.videoId);
      used.add(c.videoId);
    }
  }
  return assignments;
}

/**
 * Round-robin distribution. Used when embedding scoring is unavailable
 * (Ollama down). Quality is lost but the visual grid stays populated.
 */
export function assignEvenly(
  videoIds: string[],
  targetTotal: number = TARGET_TOTAL
): CellAssignment[] {
  const out: CellAssignment[] = Array.from({ length: NUM_CELLS }, (_, i) => ({
    cellIndex: i,
    videoIds: [],
  }));
  const limit = Math.min(videoIds.length, targetTotal);
  for (let i = 0; i < limit; i++) {
    const cell = i % NUM_CELLS;
    const id = videoIds[i];
    if (id) out[cell]?.videoIds.push(id);
  }
  return out;
}

export function totalAssigned(assignments: ReadonlyArray<CellAssignment>): number {
  return assignments.reduce((sum, a) => sum + a.videoIds.length, 0);
}
