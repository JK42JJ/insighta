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
import { getV5Config } from './config';

const log = logger.child({ module: 'video-discover/v5/youtube-fanout' });

export interface FanoutInput {
  centerGoal: string;
  subGoals: string[];
  focusTags: string[];
  targetLevel: string;
  language: 'ko' | 'en';
  env: NodeJS.ProcessEnv;
  /** CP491 ROI1 — forwarded to search.list publishedAfter (ISO date). */
  publishedAfter?: string;
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
export function isOffLanguageTitle(title: string, lang: 'ko' | 'en'): boolean {
  const t = title ?? '';
  const hangul = (t.match(/[가-힣]/g) ?? []).length;
  const han = (t.match(/[一-鿿]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  if (han < 2) return false; // not CJK-ideograph-dominant → never drop (conservative)
  if (lang === 'ko') return hangul === 0; // a Korean title would carry Hangul
  return latin === 0; // en: an English title would carry Latin letters
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
  if (cfg.queryGen === 'llm') {
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
    };
  }

  const results = await Promise.allSettled(
    queries.map((q, i) =>
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
        relevanceLanguage: input.language,
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
  const seen = new Map<string, FanoutCandidate>();

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
      if (isOffLanguageTitle(cand.title, input.language)) continue;
      seen.set(cand.videoId, cand);
      if (seen.size >= cfg.dedupHardCap) break;
    }
    if (seen.size >= cfg.dedupHardCap) break;
  }

  // CP491 F5c — per-query raw count + q_ok, computed independently of the
  // dedup/hardcap loop above so every attempted query is recorded even when
  // the cohort hits dedupHardCap early. `results` order == `queries` order
  // (Promise.allSettled preserves it).
  const perQuery: FanoutPerQuery[] = results.map((r, i) => {
    const qm = queries[i]!;
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
    queriesAttempted: queries.length,
    queriesSucceeded,
    rawItemCount,
    quotaUnitsApprox: queries.length * 100,
    perQuery,
    queryGenMs,
    queryGen,
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
