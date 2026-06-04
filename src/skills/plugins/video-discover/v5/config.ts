/**
 * v5 (LLM-pick) budget knobs.
 *
 * Latency target: 12s total. Breakdown:
 *   - YouTube fanout: ≤ 2.5s   (8 parallel × 1.5s each, allSettled)
 *   - LLM batches:    ≤ 3.5s   (5 parallel Haiku calls)
 *   - videos.list:    ≤ 0.8s   (1 call, picked ids only)
 *   - DB exclude:     ≤ 0.5s
 *   - buffer:         ≥ 4.7s
 */

import { z } from 'zod';

// Env boolean: "true" (case-insensitive) → true, anything else → false.
// Mirrors the v3/config.ts booleanFlag pattern (no z.coerce.boolean, which
// treats the string "false" as true).
const booleanFlag = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() === 'true' : Boolean(v)),
  z.boolean()
);

const v5EnvSchema = z.object({
  V5_MAX_QUERIES: z.coerce.number().int().min(1).max(20).default(8),
  V5_SEARCH_TIMEOUT_MS: z.coerce.number().int().min(500).max(8000).default(2000),
  V5_SEARCH_MAX_RESULTS: z.coerce.number().int().min(10).max(50).default(25),
  V5_TARGET_PICKS: z.coerce.number().int().min(10).max(60).default(30),
  V5_DEDUP_HARDCAP: z.coerce.number().int().min(40).max(400).default(120),
  // CP491 — short gate. Over-pick by this factor before dropping Shorts so
  // the final count holds at targetPicks (drop happens pre-final-slice).
  V5_SHORT_OVERPICK_FACTOR: z.coerce.number().min(1).max(3).default(1.5),
  // Hard wall-clock cap for the whole short-probe phase (shared deadline
  // across all probes). 0 disables the gate. Fail-open past this.
  V5_SHORT_PROBE_DEADLINE_MS: z.coerce.number().int().min(0).max(15000).default(8000),
  // CP492 — picker mode. 'llm' (default, current behavior) runs the OpenRouter
  // batch picker. 'cell_binning' skips the LLM and round-robins fanout
  // candidates by query cellIndex (9-cell balance + ~1s discover, no garbage
  // filter). A/B flag: does cell_binning let YouTube garbage through vs the LLM?
  V5_PICKER_MODE: z.enum(['llm', 'cell_binning']).default('llm'),
  // CP492 — query generation mode. 'rule' (default, current behavior) uses the
  // synchronous rule-based concat (buildRuleBasedQueriesSync). 'llm' generates
  // one searchable query per cell via a single OpenRouter Haiku call (zod-validated,
  // per-cell rule fallback). Rule-based concat produced broad/garbage queries
  // ("...학습할 수", 9-word) → YouTube sparse backfill (Chinese drama / generic
  // self-help / EN-AR leak). LLM translates each cell label into a focused
  // searchable query. unset = 'rule' = no-op (flag-off rollback).
  V5_QUERY_GEN: z.enum(['rule', 'llm']).default('rule'),
  // CP494 — pool-first backfill gate. When on, fill cells from the quota-FREE +
  // embedding-FREE video_pool tsvector match BEFORE live search; a cell the pool
  // satisfies (≥ V5_POOL_MIN_PER_CELL gold/silver candidates) drops its live
  // search.list query → quota saved. Covers wizard + add-cards (shared executor).
  // unset = false = no-op (full live fanout, flag-off rollback).
  V5_POOL_BACKFILL: booleanFlag.optional().default(false as unknown as string),
  // CP494 — pool source range (Fork 3). 'v2_promoted' = ~1.1k high-quality ko
  // only; 'all' = + batch_trend (~28k, cross-domain; downstream gates are the
  // noise safety net). Canary starts at v2_promoted, expand after measuring.
  V5_POOL_SOURCE: z.enum(['v2_promoted', 'all']).default('v2_promoted'),
  // CP494 — quality floor N. A cell needs ≥ this many pool candidates to skip
  // live search. Do NOT raise on speculation (measure pool_only_cells first).
  V5_POOL_MIN_PER_CELL: z.coerce.number().int().min(1).max(20).default(3),
  // CP494 — hot-path safety: pool query timeout (ms). On timeout/throw → full
  // live fanout fallback. tsvector on ~1.1k rows is sub-100ms; cap conservatively.
  V5_POOL_TIMEOUT_MS: z.coerce.number().int().min(200).max(5000).default(1500),
  // CP494 ③ reuse loop (keystone). When on, v5 upserts PICKED live-discovered
  // cards back to video_pool (source='user_live', fire-and-forget) AND the v5
  // pool-first match reads 'user_live' so the next request reuses them
  // (write↔read pair = loop closed). unset = false = no-op (write 0 = current).
  V5_REUSE_LOOP: booleanFlag.optional().default(false as unknown as string),
  // CP494 ④-1 full-cell skip. When on, add-cards skips searching (pool + live)
  // any cell whose existing grid-card count ≥ V5_CELL_SKIP_THRESHOLD — no
  // candidate generation for "full enough" cells (pure quota/latency save; the
  // cell's cards are already excluded anyway). unset = false = no-op.
  V5_CELL_SKIP: booleanFlag.optional().default(false as unknown as string),
  // CP494 ④-1 — per-cell "full" threshold. ≥ this many grid cards → skip.
  // 12 favors "user may want to see more" (cells with 7-11 still searched).
  V5_CELL_SKIP_THRESHOLD: z.coerce.number().int().min(1).max(60).default(12),
});

export interface V5Config {
  maxQueries: number;
  searchTimeoutMs: number;
  searchMaxResults: number;
  targetPicks: number;
  dedupHardCap: number;
  shortOverpickFactor: number;
  shortProbeDeadlineMs: number;
  pickerMode: 'llm' | 'cell_binning';
  queryGen: 'rule' | 'llm';
  /** CP494 — pool-first backfill gate enabled. */
  poolBackfill: boolean;
  /** CP494 — resolved video_pool source filter (tsvector match). */
  poolSources: string[];
  /** CP494 — raw V5_POOL_SOURCE value, for trace observability. */
  poolSourceLabel: string;
  /** CP494 — quality floor: pool candidates per cell to skip live search. */
  poolMinPerCell: number;
  /** CP494 — pool query timeout (ms) before full-live fallback. */
  poolTimeoutMs: number;
  /** CP494 ③ — reuse loop enabled (write picked → pool + read 'user_live'). */
  reuseLoop: boolean;
  /** CP494 ④-1 — full-cell skip enabled. */
  cellSkip: boolean;
  /** CP494 ④-1 — per-cell card count threshold for skip. */
  cellSkipThreshold: number;
}

let cached: V5Config | null = null;

export function getV5Config(env: NodeJS.ProcessEnv = process.env): V5Config {
  if (cached) return cached;
  const p = v5EnvSchema.parse(env);
  cached = {
    maxQueries: p.V5_MAX_QUERIES,
    searchTimeoutMs: p.V5_SEARCH_TIMEOUT_MS,
    searchMaxResults: p.V5_SEARCH_MAX_RESULTS,
    targetPicks: p.V5_TARGET_PICKS,
    dedupHardCap: p.V5_DEDUP_HARDCAP,
    shortOverpickFactor: p.V5_SHORT_OVERPICK_FACTOR,
    shortProbeDeadlineMs: p.V5_SHORT_PROBE_DEADLINE_MS,
    pickerMode: p.V5_PICKER_MODE,
    queryGen: p.V5_QUERY_GEN,
    poolBackfill: p.V5_POOL_BACKFILL,
    // CP494 ③ — when reuse loop is on, the pool-first match ALSO reads
    // 'user_live' so reused picks are consumed next request (loop closed).
    poolSources: [
      ...(p.V5_POOL_SOURCE === 'all' ? ['v2_promoted', 'batch_trend'] : ['v2_promoted']),
      ...(p.V5_REUSE_LOOP ? ['user_live'] : []),
    ],
    poolSourceLabel: p.V5_POOL_SOURCE,
    poolMinPerCell: p.V5_POOL_MIN_PER_CELL,
    poolTimeoutMs: p.V5_POOL_TIMEOUT_MS,
    reuseLoop: p.V5_REUSE_LOOP,
    cellSkip: p.V5_CELL_SKIP,
    cellSkipThreshold: p.V5_CELL_SKIP_THRESHOLD,
  };
  return cached;
}

export function resetV5ConfigForTest(): void {
  cached = null;
}
