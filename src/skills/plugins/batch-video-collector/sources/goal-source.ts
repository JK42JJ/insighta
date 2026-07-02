/**
 * batch-video-collector — Source B: goal keywords (W3, goal-driven collection).
 *
 * WHY: the pool is filled by Source A (trend keywords), so a user-goal topic
 * that isn't currently trending — middle-school English grammar, Kubernetes,
 * coding-challenge prep — never gets collected, and those mandalas stay
 * content-starved (measured 2026-07-02: grammar 1 pool video, k8s 15, vs
 * finance 673; gc tracks topic coverage). This source turns the actual user
 * mandala CELL SUB-GOALS into collection queries, so we go get the content
 * users are asking for. Ordered by frequency (popular goals first) so the
 * daily quota lands on the goals the most mandalas share.
 *
 * Returns the SAME `TrendKeyword` shape as Source A, so the executor's
 * search → quality-gate → embed → upsert flow is reused unchanged; only the
 * keyword source differs (run_type='popular_goals' → this loader).
 */

import type { PrismaClient } from '@prisma/client';

import { logger } from '@/utils/logger';
import type { TrendKeyword } from './trend-source';

const log = logger.child({ module: 'batch-video-collector/goal-source' });

const DEFAULT_DOMAIN = 'goal';
const DEFAULT_LANGUAGE = 'ko';
const MIN_GOAL_LEN = 3;

interface GoalRow {
  keyword: string;
  language: string | null;
  domain: string | null;
  freq: number | bigint;
}

/**
 * Load up to `limit` distinct user cell sub-goals as collection keywords,
 * ordered by how many cells share the goal (popular first). Deduped by
 * (keyword, language). `score` is the share-frequency normalized to [0, 1].
 */
export async function loadGoalKeywords(db: PrismaClient, limit: number): Promise<TrendKeyword[]> {
  // Over-fetch for dedup headroom, cap the DB work.
  const fetchCount = Math.max(limit * 3, 50);
  // mandala_embeddings.mandala_id is TEXT; user_mandalas.id is UUID → cast.
  const rows = await db.$queryRawUnsafe<GoalRow[]>(`
    SELECT
      me.sub_goal AS keyword,
      min(um.language) AS language,
      min(um.domain) AS domain,
      count(*)::int AS freq
    FROM mandala_embeddings me
    JOIN user_mandalas um ON um.id::text = me.mandala_id
    WHERE me.level = 1
      AND me.sub_goal IS NOT NULL
      AND length(trim(me.sub_goal)) > ${MIN_GOAL_LEN}
    GROUP BY me.sub_goal
    ORDER BY freq DESC
    LIMIT ${fetchCount}
  `);

  const maxFreq = rows.length > 0 ? Number(rows[0]!.freq) : 1;
  const seen = new Set<string>();
  const out: TrendKeyword[] = [];
  for (const r of rows) {
    const keyword = r.keyword.trim();
    const language = r.language?.trim() || DEFAULT_LANGUAGE;
    const key = `${language}::${keyword.toLowerCase()}`;
    if (keyword.length <= MIN_GOAL_LEN || seen.has(key)) continue;
    seen.add(key);
    out.push({
      keyword,
      language,
      domain: r.domain?.trim() || DEFAULT_DOMAIN,
      trendSource: 'popular_goals',
      score: maxFreq > 0 ? Number(r.freq) / maxFreq : 0,
    });
    if (out.length >= limit) break;
  }

  log.info(
    `loaded ${out.length} goal keywords (from ${rows.length} raw cell-goals, limit ${limit})`
  );
  return out;
}
