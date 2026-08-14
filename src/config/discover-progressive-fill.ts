/**
 * Progressive fill — embedding/serving decouple, placement-preserving
 * (2026-07-11, supervisor-approved design; James "분리 진행해").
 *
 * The v3 wizard discover embeds ALL capped candidates in one batch before ANY
 * card is written, so a slow/hung embed provider stalls first-paint (the 7/6+
 * DeepInfra incident: 27-96s runs). Naive decoupling (serve lexical now,
 * re-rank later) corrupts CELL PLACEMENT — in semantic mode the sub-goal
 * argmax IS the embedding, so late re-ranks either shuffle visible cards or
 * leave them mis-filed (James: "섹터별 카드 배치에 영향 없어?").
 *
 * Progressive fill instead keeps the semantic gate but runs it in CHUNKS:
 * each chunk is embedded + gated + upserted immediately (cardPublisher SSE
 * fires per row — the original "first card ~1-2s" design), so the grid FILLS
 * OVER SECONDS and cards never move or vanish. Supervisor conditions:
 *  1. greedy-loss mitigation — first chunk is small and cell-round-robin
 *     (grid fills evenly), and each chunk may place at most PER_CHUNK_CELL_CAP
 *     per cell so later, better candidates keep an open slot;
 *  2. the never-zero floor must only fire AFTER the final chunk;
 *  3. SSE lifetime / FE polling fallback is a deploy verification item.
 *
 * DEFAULT OFF and NOT enabled in compose — this is a ready lever for the next
 * embed-provider degradation (flip during beta only if that class recurs);
 * with embeds healthy (~0.5s) the flip's marginal gain does not justify
 * changing the serving core on beta D-day (supervisor final call).
 */
const DEFAULT_FIRST_CHUNK_SIZE = 12; // cell-coverage first paint (8-16 band)
const DEFAULT_CHUNK_SIZE = 25;
const DEFAULT_PER_CHUNK_CELL_CAP = 2;

export function isProgressiveFillEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['DISCOVER_PROGRESSIVE_FILL'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = Number(env[key]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

export interface ProgressiveFillConfig {
  firstChunkSize: number;
  chunkSize: number;
  perChunkCellCap: number;
}

export function getProgressiveFillConfig(
  env: NodeJS.ProcessEnv = process.env
): ProgressiveFillConfig {
  return {
    firstChunkSize: intEnv(env, 'DISCOVER_PF_FIRST_CHUNK', DEFAULT_FIRST_CHUNK_SIZE),
    chunkSize: intEnv(env, 'DISCOVER_PF_CHUNK', DEFAULT_CHUNK_SIZE),
    perChunkCellCap: intEnv(env, 'DISCOVER_PF_CELL_CAP', DEFAULT_PER_CHUNK_CELL_CAP),
  };
}

/**
 * Split candidates into embed/gate chunks. The FIRST chunk is built
 * round-robin across cellIndexHint groups (supervisor cond. 1) so the very
 * first paint covers cells evenly instead of exhausting one cell; remaining
 * candidates follow in original (search-rank) order, sliced by chunkSize.
 * Pure function — unit-tested directly.
 */
export function planProgressiveChunks<T>(
  candidates: T[],
  cfg: ProgressiveFillConfig,
  getHint: (c: T) => number | null | undefined = () => null
): T[][] {
  if (candidates.length === 0) return [];

  // Round-robin the first chunk across hint groups (nulls form their own lane).
  const lanes = new Map<number, T[]>();
  for (const c of candidates) {
    const lane = getHint(c) ?? -1;
    if (!lanes.has(lane)) lanes.set(lane, []);
    lanes.get(lane)!.push(c);
  }
  const laneKeys = [...lanes.keys()].sort((a, b) => a - b);
  const first: T[] = [];
  const taken = new Set<T>();
  for (let round = 0; first.length < cfg.firstChunkSize; round++) {
    let addedThisRound = 0;
    for (const k of laneKeys) {
      const lane = lanes.get(k)!;
      const item = lane[round];
      if (!item) continue;
      first.push(item);
      taken.add(item);
      addedThisRound++;
      if (first.length >= cfg.firstChunkSize) break;
    }
    if (addedThisRound === 0) break; // all lanes exhausted
  }

  const rest = candidates.filter((c) => !taken.has(c));
  const chunks: T[][] = first.length > 0 ? [first] : [];
  for (let i = 0; i < rest.length; i += cfg.chunkSize) {
    chunks.push(rest.slice(i, i + cfg.chunkSize));
  }
  return chunks;
}
