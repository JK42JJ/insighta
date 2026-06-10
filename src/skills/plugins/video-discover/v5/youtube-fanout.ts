/**
 * v5 YouTube fanout — parallel search.list across rule-based queries.
 *
 * Strategy:
 *   - buildRuleBasedQueriesSync (no LLM; sub-ms) → N queries
 *   - Promise.allSettled with per-call timeout (single slow query never
 *     blocks the cohort)
 *   - Dedup by videoId, drop Shorts via title heuristic (cheap; no
 *     videos.list call in the hot path)
 *   - Cap raw pool to dedupHardCap (default 120) before handing to LLM
 *
 * Quota cost (worst case): maxQueries × 100 units. With default 8 →
 * 800 units / Add Cards call.
 */

import { logger } from '@/utils/logger';
import {
  searchVideos,
  resolveSearchApiKeys,
  titleIndicatesShorts,
  titleHitsBlocklist,
  type YouTubeSearchItem,
} from '../v2/youtube-client';
import { buildRuleBasedQueriesSync, type SearchQuery } from '../v2/keyword-builder';
import { buildLLMQueriesPerCell, type QueryGenMeta } from './llm-query-gen';
import { translateQueriesToEn, computeWeakCells } from './en-query-translate';
import { getV5Config } from './config';
import { MERGED_GEN_MODEL } from '@/prompts/mandala-with-queries-generator';
import {
  tsvectorKeywordCandidates,
  tsvectorKeywordCandidatesPerCell,
  type KeywordCandidate,
} from '../v3/hybrid-rerank';

/**
 * CP494 안 A — extra pool candidates fetched per cell beyond poolMinPerCell,
 * so a cell at the floor still has headroom after the shared blocklist/shorts/
 * off-language gates drop some. Mirrors the global path's `+5` buffer.
 */
const POOL_PER_CELL_BUFFER = 5;

const log = logger.child({ module: 'video-discover/v5/youtube-fanout' });

/**
 * CP493 — a per-cell query produced upstream by the merged structure+queries
 * generation (generateMandalaWithQueries). Structurally identical to the
 * generator's CellQuery; kept local so the v5 layer owns its own input type.
 */
export interface PrecomputedQuery {
  cellIndex: number;
  query: string;
}

export interface FanoutInput {
  centerGoal: string;
  subGoals: string[];
  focusTags: string[];
  targetLevel: string;
  language: 'ko' | 'en';
  /**
   * CP499+ '영문 카드 포함' toggle (user_skill_config.config.includeEnCards).
   * ko mandala + true → live search drops the relevanceLanguage=ko bias and
   * the off-language gate widens to ko ∪ en (third-script content stays
   * blocked). Undefined/false = current ko-only behaviour, bit-identical.
   */
  includeEnCards?: boolean;
  env: NodeJS.ProcessEnv;
  /** CP491 ROI1 — forwarded to search.list publishedAfter (ISO date). */
  publishedAfter?: string;
  /**
   * CP493 — merged-gen queries (one per cell, full coverage). When present,
   * fanout uses these verbatim and SKIPS query-gen (the disconnected Haiku #2
   * call), preserving the goal-structure context. Absent = legacy query-gen.
   */
  precomputedQueries?: PrecomputedQuery[];
  /**
   * CP494 ④-1 — cellIndices the user has already filled (≥ threshold). Their
   * queries are dropped upstream of the pool gate (searched neither pool nor
   * live). Empty/absent = search all cells (current behavior).
   */
  fullCellIndices?: number[];
}

export interface FanoutCandidate {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  thumbnailUrl: string;
  cellIndex: number | null;
}

/** CP491 F5c — per-query observability (raw count + q_ok), independent of dedup/hardcap. */
export interface FanoutPerQuery {
  query: string;
  source: string;
  cellIndex: number | null;
  rawCount: number;
  fulfilled: boolean;
}

/** CP499+ EN query pass observability (verification surface for the toggle). */
export interface EnPassMeta {
  /** Pass attempted (toggle ON + ko + weak cells existed + translation ok). */
  fired: boolean;
  /** Cells below the raw threshold after the ko first pass. */
  weakCells: number[];
  /** Translation call succeeded (false + weakCells>0 = fail-open skip). */
  translated: boolean;
  queriesFired: number;
  rawItems: number;
  candidatesAdded: number;
}

export interface FanoutResult {
  candidates: FanoutCandidate[];
  queriesAttempted: number;
  queriesSucceeded: number;
  rawItemCount: number;
  quotaUnitsApprox: number;
  /** CP491 F5c — one entry per attempted query (order = queries order). */
  perQuery: FanoutPerQuery[];
  /** CP492 Track-1 — query-gen wall-time (ms), split out of the search portion. */
  queryGenMs: number;
  /** CP492 Track-1 — query-gen telemetry (mode/model/latency/fallback). */
  queryGen: QueryGenMeta;
  /** CP492 2차 gate — candidates dropped by the off-language script filter. */
  offLangDropped: number;
  /** CP494 — pool-first backfill telemetry (quota delta + Fork-2 quality tradeoff). */
  poolBackfill: PoolBackfillMeta;
  /** CP494 ④-1 — # of cell queries skipped because the cell was already full. */
  skippedFullCells: number;
  /** CP499+ EN query pass observability ('영문 카드 포함' toggle). */
  enPass: EnPassMeta;
}

/**
 * CP494 — pool-first gate observability. `poolOnlyCells` = cells that went 100%
 * lexical (live query dropped) → the Fork-2(A) quality tradeoff surface.
 * `liveCells` × 100 ≈ quota spent; (totalCells − liveCells) × 100 ≈ quota saved.
 */
export interface PoolBackfillMeta {
  /** flag on (V5_POOL_BACKFILL). */
  enabled: boolean;
  /** pool query timed out or threw → fell back to full live fanout (hot-path safety). */
  fellBackToLive: boolean;
  /** pool tsvector query wall-time (ms). */
  poolQueryMs: number;
  /** pool candidates kept after the same blocklist/shorts/off-language gates as live. */
  poolCandidates: number;
  /** cells the pool satisfied (≥ poolMinPerCell) → live query dropped (100% lexical). */
  poolOnlyCells: number;
  /** cells whose live search.list query still ran. */
  liveCells: number;
  /** resolved pool source label (v2_promoted | all). */
  source: string;
  /** CP494 안 A — which pool match ran ('global' | 'per_cell'). */
  matchMode: string;
}

/** CP494 — no-op meta for the flag-off / pre-gate paths. */
const POOL_BACKFILL_OFF = (liveCells: number): PoolBackfillMeta => ({
  enabled: false,
  fellBackToLive: false,
  poolQueryMs: 0,
  poolCandidates: 0,
  poolOnlyCells: 0,
  liveCells,
  source: 'off',
  matchMode: 'off',
});

/**
 * CP494 안 A — collapse a query list into one {cellIndex, query} per cell for the
 * per-cell pool match. Queries without a cellIndex (rule-mode core/focus/level)
 * are skipped; multiple queries on one cell are token-merged (space-joined).
 */
export function perCellQueriesFrom(
  queries: ReadonlyArray<SearchQuery>
): { cellIndex: number; query: string }[] {
  const byCell = new Map<number, string[]>();
  for (const q of queries) {
    if (q.cellIndex == null) continue;
    const bucket = byCell.get(q.cellIndex);
    if (bucket) bucket.push(q.query);
    else byCell.set(q.cellIndex, [q.query]);
  }
  return Array.from(byCell, ([cellIndex, qs]) => ({ cellIndex, query: qs.join(' ') }));
}

/**
 * CP494 — reject after `ms` so a slow pool query never blocks the discover
 * hot path. The underlying Postgres query is not cancelled (it completes and is
 * discarded), but the caller falls through to full live fanout.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`pool query timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** CP494 — map a video_pool KeywordCandidate to the fanout candidate contract. */
function keywordCandidateToFanoutCandidate(kc: KeywordCandidate): FanoutCandidate {
  return {
    videoId: kc.videoId,
    title: kc.title,
    description: kc.description ?? '',
    channelTitle: kc.channelName ?? '',
    channelId: kc.channelId ?? '',
    publishedAt: kc.publishedAt ? kc.publishedAt.toISOString() : '',
    thumbnailUrl: kc.thumbnail ?? '',
    cellIndex: kc.cellIndex,
  };
}

/** CP492 Track-1 — meta for the rule branch (LLM never attempted). */
const RULE_QUERY_GEN_META = (totalCells: number): QueryGenMeta => ({
  mode: 'rule',
  latencyMs: 0,
  llmCells: 0,
  totalCells,
  fellBack: false,
});

/**
 * Rotate `keys` so index `i` starts at `keys[i % len]`, with the remaining keys
 * following as failover order. Spreads N parallel queries across N keys so each
 * key sees ~1 concurrent request instead of N (which 429s on keys[0]). Returns
 * the array unchanged for 0/1-key inputs. Exported for tests.
 */
export function rotateKeys(keys: string[], i: number): string[] {
  if (keys.length <= 1) return keys;
  const offset = ((i % keys.length) + keys.length) % keys.length;
  return [...keys.slice(offset), ...keys.slice(0, offset)];
}

/**
 * Conservative off-language detector. YouTube ignores relevanceLanguage for
 * sparse queries and backfills high-view global content — a Korean basketball
 * query surfaced Chinese dramas (彩礼加倍 / 重生换嫁). Drop a title ONLY when it
 * is dominated by a non-target script, so legitimate content survives:
 *   - ko: Korean titles always contain Hangul. Zero Hangul + ≥2 CJK ideographs
 *         (Han) = Chinese/Japanese → drop. English-titled ("[Team Drill]") has
 *         no Han → kept; Hanja-mixed Korean has Hangul → kept.
 *   - en: Latin-script. Zero Latin letters + ≥2 Han = CJK content → drop.
 * Exported for tests.
 */
/**
 * CP499+ — toggle-aware off-language gate ('영문 카드 포함').
 *
 * DESIGN FINDING (test-caught): the ko-rules ALREADY pass pure-English titles
 * (hangul 0 + no dominant third script = kept), so the gate needs NO widening
 * for the toggle — and a ko∪en union would be actively WRONG: the en-rules
 * only block CJK, so Arabic/Thai/Cyrillic titles would re-enter through the
 * en side. The toggle's effective EN-inflow lever is therefore the
 * relevanceLanguage drop in the search call alone; this function keeps the
 * toggle branch explicit at both call sites and pins the EN-passes invariant.
 * Exported for tests.
 */
export function isOffLanguageTitleToggled(
  title: string,
  lang: 'ko' | 'en',
  _includeEnCards: boolean | undefined
): boolean {
  return isOffLanguageTitle(title, lang);
}

export function isOffLanguageTitle(title: string, lang: 'ko' | 'en'): boolean {
  const t = title ?? '';
  const hangul = (t.match(/[가-힣]/g) ?? []).length;
  const han = (t.match(/[一-鿿]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;

  if (lang === 'ko') {
    // A legitimate Korean title carries Hangul (incl. English-titled or
    // Hanja-mixed Korean) → always keep.
    if (hangul > 0) return false;
    // No Hangul + dominated by a clearly-foreign script → drop.
    //  - CJK ideographs (CP491 #831): Chinese / Japanese.
    //  - T1 (CP492): Arabic / Thai / Cyrillic / Devanagari / Hebrew.
    //  - T2 (CP492): Turkish is Latin-based (script-invisible); its diacritics
    //    (çÇıİşŞğĞ) are the only cheap signal — ≥2 keeps false positives near
    //    zero (a Korean/English title virtually never carries 2+ of these).
    const arabic = (t.match(/[؀-ۿ]/g) ?? []).length;
    const thai = (t.match(/[฀-๿]/g) ?? []).length;
    const cyrillic = (t.match(/[Ѐ-ӿ]/g) ?? []).length;
    const devanagari = (t.match(/[ऀ-ॿ]/g) ?? []).length;
    const hebrew = (t.match(/[֐-׿]/g) ?? []).length;
    const turkish = (t.match(/[çÇıİşŞğĞ]/g) ?? []).length;
    if (
      han >= 2 ||
      arabic >= 2 ||
      thai >= 2 ||
      cyrillic >= 2 ||
      devanagari >= 2 ||
      hebrew >= 2 ||
      turkish >= 2
    ) {
      return true;
    }
    // Pure Latin / English (no Hangul) is a TOPIC-relevance question — off-topic
    // English like "Inside SpaceX's Flywheel" is VALID English, just wrong topic.
    // That is NOT a language drop; it is handled by Track 3 (cell-card semantic
    // fit). English is intentionally NEVER dropped here (would also false-drop
    // English-titled Korean content + valid English for AI/global mandalas).
    return false;
  }

  // en mandala — unchanged conservative behavior (CP491 #831).
  if (han < 2) return false;
  return latin === 0; // an English title would carry Latin letters
}

export async function runYouTubeFanout(input: FanoutInput): Promise<FanoutResult> {
  const cfg = getV5Config(input.env);
  const apiKeys = resolveSearchApiKeys(input.env);
  if (apiKeys.length === 0) {
    log.warn('v5 fanout: no YouTube API keys configured');
    return {
      candidates: [],
      queriesAttempted: 0,
      queriesSucceeded: 0,
      rawItemCount: 0,
      quotaUnitsApprox: 0,
      perQuery: [],
      queryGenMs: 0,
      queryGen: RULE_QUERY_GEN_META(0),
      offLangDropped: 0,
      poolBackfill: POOL_BACKFILL_OFF(0),
      skippedFullCells: 0,
      enPass: {
        fired: false,
        weakCells: [],
        translated: false,
        queriesFired: 0,
        rawItems: 0,
        candidatesAdded: 0,
      },
    };
  }

  const queryInput = {
    centerGoal: input.centerGoal,
    subGoals: input.subGoals,
    focusTags: input.focusTags,
    targetLevel: input.targetLevel,
    language: input.language,
  };
  // CP492 — V5_QUERY_GEN=llm translates each cell label into a focused,
  // searchable query (1 Haiku call, per-cell rule fallback). Default 'rule'
  // keeps the synchronous rule-based concat. buildLLMQueriesPerCell never
  // throws — it returns rule-based queries on any failure.
  const totalCells = queryInput.subGoals.map((s) => s.trim()).filter(Boolean).length;
  const tQueryGen0 = Date.now();
  let queries: SearchQuery[];
  let queryGen: QueryGenMeta;
  const precomputed = input.precomputedQueries;
  if (precomputed && precomputed.length > 0) {
    // CP493 — merged-gen path: queries were generated upstream in the SAME
    // Haiku call as the structure (goal-context continuous). Use verbatim, skip
    // the disconnected query-gen call. latencyMs=0 here (cost was at gen time).
    queries = precomputed.map((p) => ({
      query: p.query,
      source: 'merged' as const,
      cellIndex: p.cellIndex,
    }));
    queryGen = {
      mode: 'merged',
      model: MERGED_GEN_MODEL,
      latencyMs: 0,
      llmCells: precomputed.length,
      totalCells,
      fellBack: false,
    };
  } else if (cfg.queryGen === 'llm') {
    const r = await buildLLMQueriesPerCell(queryInput, {
      openRouterApiKey: input.env['OPENROUTER_API_KEY'],
      maxQueries: cfg.maxQueries,
    });
    queries = r.queries;
    queryGen = r.meta;
  } else {
    queries = buildRuleBasedQueriesSync(queryInput, cfg.maxQueries);
    queryGen = RULE_QUERY_GEN_META(totalCells);
  }
  const queryGenMs = Date.now() - tQueryGen0;

  if (queries.length === 0) {
    return {
      candidates: [],
      queriesAttempted: 0,
      queriesSucceeded: 0,
      rawItemCount: 0,
      quotaUnitsApprox: 0,
      perQuery: [],
      queryGenMs,
      queryGen,
      offLangDropped: 0,
      poolBackfill: POOL_BACKFILL_OFF(0),
      skippedFullCells: 0,
      enPass: {
        fired: false,
        weakCells: [],
        translated: false,
        queriesFired: 0,
        rawItems: 0,
        candidatesAdded: 0,
      },
    };
  }

  // CP494 — pool-first gate. Fill cells from the quota-FREE + embedding-FREE
  // video_pool tsvector match BEFORE live search; cells the pool satisfies
  // (≥ poolMinPerCell) drop their live query → quota saved. Hot-path safety
  // (non-negotiable): timeout + try/catch → ANY failure falls back to full live
  // fanout. Pool candidates pass the SAME blocklist/shorts/off-language gates as
  // live below (lexical match = supplier; existing gates = quality judge).
  // CP494 ④-1 full-cell skip — drop queries for cells the user already filled
  // (≥ threshold), UPSTREAM of the pool gate so the cell is searched neither in
  // pool nor live. Separate counter (not pool 'satisfied') → no meta pollution.
  const fullCellSet = new Set<number>(input.fullCellIndices ?? []);
  const skippedFullCells = fullCellSet.size
    ? queries.filter((q) => q.cellIndex != null && fullCellSet.has(q.cellIndex)).length
    : 0;
  const activeQueries: SearchQuery[] = fullCellSet.size
    ? queries.filter((q) => !(q.cellIndex != null && fullCellSet.has(q.cellIndex)))
    : queries;

  let liveQueries: SearchQuery[] = activeQueries;
  const poolSeed: FanoutCandidate[] = [];
  let poolMeta: PoolBackfillMeta = POOL_BACKFILL_OFF(activeQueries.length);
  if (cfg.poolBackfill) {
    const tPool0 = Date.now();
    // CP494 안 A — per-cell match when V5_POOL_MATCH=per_cell AND active cells
    // carry queries with cellIndex (prod V5_QUERY_GEN=llm / merged-gen always do).
    // Else fall back to the global centerGoal-OR match (current behavior).
    const perCellQueries = cfg.poolMatch === 'per_cell' ? perCellQueriesFrom(activeQueries) : [];
    const usePerCell = perCellQueries.length > 0;
    const matchMode = usePerCell ? 'per_cell' : 'global';
    try {
      const poolLimit = totalCells * (cfg.poolMinPerCell + POOL_PER_CELL_BUFFER);
      const pool = await withTimeout(
        // exclude=[] — the executor applies excludeVideoIds AFTER fanout, so
        // already-owned cards are dropped downstream (minor pool waste, no bug).
        usePerCell
          ? tsvectorKeywordCandidatesPerCell(
              perCellQueries,
              [],
              cfg.poolMinPerCell + POOL_PER_CELL_BUFFER,
              cfg.poolSources
            )
          : tsvectorKeywordCandidates(
              input.centerGoal,
              input.subGoals,
              [],
              poolLimit,
              cfg.poolSources
            ),
        cfg.poolTimeoutMs
      );
      const byCell = new Map<number, FanoutCandidate[]>();
      for (const kc of pool) {
        const cand = keywordCandidateToFanoutCandidate(kc);
        // Fork-1 caveat: pool candidates run the SAME gates as live items.
        if (titleHitsBlocklist(cand.title) || titleIndicatesShorts(cand.title)) continue;
        if (isOffLanguageTitleToggled(cand.title, input.language, input.includeEnCards)) continue;
        const ci = cand.cellIndex ?? -1;
        if (ci < 0) continue;
        const bucket = byCell.get(ci);
        if (bucket) bucket.push(cand);
        else byCell.set(ci, [cand]);
      }
      const satisfied = new Set<number>();
      for (const [ci, cands] of byCell) {
        // ALL pool candidates feed supply (deficit cells get pool + live);
        // only cells at/above the floor drop their live query.
        poolSeed.push(...cands);
        if (cands.length >= cfg.poolMinPerCell) satisfied.add(ci);
      }
      liveQueries = activeQueries.filter(
        (q) => !(q.cellIndex != null && satisfied.has(q.cellIndex))
      );
      poolMeta = {
        enabled: true,
        fellBackToLive: false,
        poolQueryMs: Date.now() - tPool0,
        poolCandidates: poolSeed.length,
        poolOnlyCells: satisfied.size,
        liveCells: liveQueries.length,
        source: cfg.poolSourceLabel,
        matchMode,
      };
    } catch (err) {
      // Hot-path safety: any pool failure → full live fanout (active cells only).
      liveQueries = activeQueries;
      poolSeed.length = 0;
      poolMeta = {
        enabled: true,
        fellBackToLive: true,
        poolQueryMs: Date.now() - tPool0,
        poolCandidates: 0,
        poolOnlyCells: 0,
        liveCells: activeQueries.length,
        source: cfg.poolSourceLabel,
        matchMode,
      };
      log.warn(
        `v5 fanout: pool backfill failed → full live fallback: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const results = await Promise.allSettled(
    liveQueries.map((q, i) =>
      searchVideos({
        query: q.query,
        // CP492 — distribute the primary key per query. searchVideos tries keys
        // in array order (failover). Passing the same array to all N parallel
        // queries made every query hammer keys[0] simultaneously → YouTube
        // 429 rateLimitExceeded → cascade through all keys → queriesSucceeded
        // collapsed (observed 4/8 normally, 0/8 under burst = the "0 results"
        // add-cards bug AND a silent ~50% supply loss). Rotating the start
        // index spreads N queries across N keys (~1 concurrent/key) while
        // keeping the rest as failover.
        apiKey: rotateKeys(apiKeys, i),
        maxResults: cfg.searchMaxResults,
        // CP499+ toggle — ON drops the ko bias so EN candidates can actually
        // enter live results (the pool is 5.9% EN; live is the supply body).
        // searchVideos omits the param when undefined (youtube-client :223).
        relevanceLanguage:
          input.includeEnCards && input.language === 'ko' ? undefined : input.language,
        // CP492 — region bias (ko→KR, en→US). relevanceLanguage alone is a soft
        // hint YouTube ignores for sparse queries (it backfilled "드리블 핸들링"
        // with a high-view Chinese drama). regionCode nudges toward the locale;
        // the hard guard is the off-language title drop in the loop below.
        regionCode: input.language === 'ko' ? 'KR' : 'US',
        timeoutMs: cfg.searchTimeoutMs,
        publishedAfter: input.publishedAfter,
      }).then((items) => ({ items, cellIndex: q.cellIndex ?? null }))
    )
  );

  let rawItemCount = 0;
  let queriesSucceeded = 0;
  let offLangDropped = 0;
  const seen = new Map<string, FanoutCandidate>();

  // CP494 — seed pool candidates first (already gate-filtered above) so they get
  // priority position in the dedup map; live results merge in after.
  for (const cand of poolSeed) {
    if (seen.size >= cfg.dedupHardCap) break;
    if (!seen.has(cand.videoId)) seen.set(cand.videoId, cand);
  }

  for (const r of results) {
    if (r.status !== 'fulfilled') {
      log.debug(`v5 fanout query rejected: ${String(r.reason)}`);
      continue;
    }
    queriesSucceeded += 1;
    const { items, cellIndex } = r.value;
    for (const it of items) {
      rawItemCount += 1;
      const cand = toFanoutCandidate(it, cellIndex);
      if (!cand) continue;
      if (seen.has(cand.videoId)) continue;
      if (titleHitsBlocklist(cand.title) || titleIndicatesShorts(cand.title)) continue;
      // CP492 — off-language hard drop. YouTube backfills sparse queries with
      // high-view global content (Chinese dramas on a Korean basketball query).
      // Conservative: only drop titles dominated by a non-target script (see
      // isOffLanguageTitle) so English-titled or Hanja-mixed Korean content is kept.
      if (isOffLanguageTitleToggled(cand.title, input.language, input.includeEnCards)) {
        offLangDropped += 1;
        continue;
      }
      seen.set(cand.videoId, cand);
      if (seen.size >= cfg.dedupHardCap) break;
    }
    if (seen.size >= cfg.dedupHardCap) break;
  }

  // ── CP499+ EN query pass ('영문 카드 포함', weak-cell-only) ──────────────
  // T1 measurement: dropping relevanceLanguage alone moved EN inflow 7%→5%
  // (noise) — the dominant variable is the QUERY language. So when the toggle
  // is ON, cells whose ko first-pass raw total is below the threshold get
  // their query translated to English (1 fail-open LLM call) and re-fired
  // (+100u per weak cell, vs +800u full-mandala). The weak-cell cut
  // auto-targets KO-absent domains — no manual domain classification.
  const enPass: EnPassMeta = {
    fired: false,
    weakCells: [],
    translated: false,
    queriesFired: 0,
    rawItems: 0,
    candidatesAdded: 0,
  };
  const enPerQuery: FanoutPerQuery[] = [];
  if (input.includeEnCards && input.language === 'ko' && liveQueries.length > 0) {
    const perCellRaw = new Map<number, number>();
    results.forEach((r, i) => {
      const ci = liveQueries[i]!.cellIndex;
      if (typeof ci !== 'number') return;
      const raw = r.status === 'fulfilled' ? r.value.items.length : 0;
      perCellRaw.set(ci, (perCellRaw.get(ci) ?? 0) + raw);
    });
    enPass.weakCells = computeWeakCells(perCellRaw, cfg.enPassRawThreshold);

    if (enPass.weakCells.length > 0) {
      const weakSet = new Set(enPass.weakCells);
      const targetByCell = new Map<number, string>();
      for (const q of liveQueries) {
        if (typeof q.cellIndex === 'number' && weakSet.has(q.cellIndex)) {
          if (!targetByCell.has(q.cellIndex)) targetByCell.set(q.cellIndex, q.query);
        }
      }
      const targets = [...targetByCell.entries()].map(([cellIndex, query]) => ({
        cellIndex,
        query,
      }));
      const translated = await translateQueriesToEn(targets, {
        apiKey: input.env['OPENROUTER_API_KEY'],
      });

      if (translated) {
        enPass.translated = true;
        enPass.fired = true;
        const enResults = await Promise.allSettled(
          [...translated.entries()].map(([cellIndex, query], i) =>
            searchVideos({
              query,
              apiKey: rotateKeys(apiKeys, liveQueries.length + i),
              maxResults: cfg.searchMaxResults,
              // No language bias on purpose; regionCode KR keeps the
              // "EN content consumed in Korea" slant (James-approved).
              regionCode: 'KR',
              timeoutMs: cfg.searchTimeoutMs,
              publishedAfter: input.publishedAfter,
            }).then((items) => ({ items, cellIndex, query }))
          )
        );
        enPass.queriesFired = targets.length;

        for (const r of enResults) {
          if (r.status !== 'fulfilled') {
            enPerQuery.push({
              query: '(en-pass)',
              source: 'en_pass',
              cellIndex: null,
              rawCount: 0,
              fulfilled: false,
            });
            continue;
          }
          const { items, cellIndex, query } = r.value;
          enPerQuery.push({
            query,
            source: 'en_pass',
            cellIndex,
            rawCount: items.length,
            fulfilled: true,
          });
          for (const it of items) {
            enPass.rawItems += 1;
            rawItemCount += 1;
            const cand = toFanoutCandidate(it, cellIndex);
            if (!cand) continue;
            if (seen.has(cand.videoId)) continue;
            if (titleHitsBlocklist(cand.title) || titleIndicatesShorts(cand.title)) continue;
            if (isOffLanguageTitleToggled(cand.title, input.language, input.includeEnCards)) {
              offLangDropped += 1;
              continue;
            }
            seen.set(cand.videoId, cand);
            enPass.candidatesAdded += 1;
            if (seen.size >= cfg.dedupHardCap) break;
          }
          if (seen.size >= cfg.dedupHardCap) break;
        }
        log.info(
          `v5 en-pass: cells=[${enPass.weakCells.join(',')}] fired=${enPass.queriesFired} raw=${enPass.rawItems} added=${enPass.candidatesAdded}`
        );
      } else {
        log.info(
          `v5 en-pass: weak cells [${enPass.weakCells.join(',')}] but translation unavailable — skipped (fail-open)`
        );
      }
    }
  }

  // CP491 F5c — per-query raw count + q_ok, computed independently of the
  // dedup/hardcap loop above so every attempted query is recorded even when
  // the cohort hits dedupHardCap early. `results` order == `queries` order
  // (Promise.allSettled preserves it).
  const perQuery: FanoutPerQuery[] = results.map((r, i) => {
    const qm = liveQueries[i]!;
    return {
      query: qm.query,
      source: qm.source,
      cellIndex: qm.cellIndex ?? null,
      rawCount: r.status === 'fulfilled' ? r.value.items.length : 0,
      fulfilled: r.status === 'fulfilled',
    };
  });

  return {
    candidates: Array.from(seen.values()),
    // CP494 — attempted/quota now reflect ONLY the live queries actually fired
    // (pool-satisfied cells dropped theirs). poolBackfill carries the delta.
    // CP499+ — the EN pass adds its fired queries to quota (100u each).
    queriesAttempted: liveQueries.length,
    queriesSucceeded,
    rawItemCount,
    quotaUnitsApprox: (liveQueries.length + enPass.queriesFired) * 100,
    perQuery: [...perQuery, ...enPerQuery],
    queryGenMs,
    queryGen,
    offLangDropped,
    poolBackfill: poolMeta,
    skippedFullCells,
    enPass,
  };
}

function toFanoutCandidate(
  item: YouTubeSearchItem,
  cellIndex: number | null
): FanoutCandidate | null {
  const videoId = item.id?.videoId;
  if (!videoId) return null;
  const sn = item.snippet ?? {};
  return {
    videoId,
    title: sn.title ?? '',
    description: sn.description ?? '',
    channelTitle: sn.channelTitle ?? '',
    channelId: sn.channelId ?? '',
    publishedAt: sn.publishedAt ?? '',
    thumbnailUrl: sn.thumbnails?.high?.url ?? '',
    cellIndex,
  };
}
