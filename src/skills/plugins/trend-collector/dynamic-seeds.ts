/**
 * trend-collector — dynamic seed expansion (Phase 1.5b, CP353)
 *
 * Loads a random sample of meaningful user mandala center_goals from
 * `user_mandala_levels` (depth=0) and runs the LLM keyword extractor
 * on them to harvest topic keywords. Those keywords become additional
 * `LearningSeed[]` entries that the trend-collector executor merges
 * with the hardcoded `LEARNING_SEED_TERMS` before calling the YouTube
 * Suggest API.
 *
 * Why this exists:
 *   The hardcoded 30 seed terms cover broad learning domains (programming,
 *   TOEIC, fitness, etc) but miss long-tail user goals like "향수 브랜드
 *   런칭", "분산 시스템 전문가", "음악 치료사 자격". Without those terms
 *   in the keyword pool, the closest match for a 향수 mandala becomes
 *   "식단" or "시간관리" — clearly wrong.
 *
 *   By extracting topic keywords from real user mandalas, the seed pool
 *   grows organically with the platform's actual user base.
 *
 * Filtering applied at the SQL level (not LLM):
 *   - depth=0 root level only
 *   - subjects array length >= 8 (mandala has been filled in)
 *   - center_goal length >= 12 chars (skips "테스트", "새 만다라" stubs)
 *   - excludes obvious meta strings (테스트/임시/test)
 *
 * Each surviving center_goal goes through `extractKeywordsBatch` which
 * already includes the `isValidLearningKeyword` noise filter — so the
 * resulting seeds are clean topic nouns.
 */

import { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import { extractKeywordsBatch } from './sources/llm-extract';
import type { LearningSeed } from './seed-terms';

const log = logger.child({ module: 'trend-collector/dynamic-seeds' });

/** How many mandala center_goals to sample per run (LLM cost: ~1 chunk/5 goals). */
export const DEFAULT_DYNAMIC_SEED_SAMPLE_SIZE = 30;

/** learning_score floor — same as the trend-collector LLM extract gate. */
const DYNAMIC_SEED_LEARNING_THRESHOLD = 0.3;

/** Synthetic domain tag for seeds harvested from user mandalas. */
export const DYNAMIC_SEED_DOMAIN = 'user-derived';

export interface LoadDynamicSeedsOptions {
  /** Override sample size. Defaults to DEFAULT_DYNAMIC_SEED_SAMPLE_SIZE. */
  sampleSize?: number;
  /** Inject fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Inject Ollama base URL (defaults to Mac Mini). */
  ollamaUrl?: string;
}

/**
 * Load + extract dynamic learning seeds from real user mandalas.
 *
 * Soft failure: returns [] on any error (DB query, LLM extract, etc).
 * The trend-collector executor MUST treat dynamic seeds as augmentation,
 * not requirement — the hardcoded seeds always run regardless.
 */
export async function loadDynamicSeedsFromMandalas(
  opts: LoadDynamicSeedsOptions = {}
): Promise<LearningSeed[]> {
  const sampleSize = opts.sampleSize ?? DEFAULT_DYNAMIC_SEED_SAMPLE_SIZE;
  const db = getPrismaClient();

  // Pull a random sample of meaningful center_goals.
  // CTE is required because `SELECT DISTINCT ... ORDER BY random()` is
  // rejected by Postgres (random() not in the select list).
  let rows: { center_goal: string }[];
  try {
    rows = await db.$queryRaw<{ center_goal: string }[]>(
      Prisma.sql`WITH unique_goals AS (
                   SELECT DISTINCT center_goal
                   FROM user_mandala_levels
                   WHERE depth = 0
                     AND array_length(subjects, 1) >= 8
                     AND length(center_goal) >= 12
                     AND center_goal NOT ILIKE '%테스트%'
                     AND center_goal NOT ILIKE '%임시%'
                     AND center_goal NOT ILIKE '%test%'
                 )
                 SELECT center_goal
                 FROM unique_goals
                 ORDER BY random()
                 LIMIT ${sampleSize}`
    );
  } catch (err) {
    // Prisma wraps the actual error in `meta.message`; surface both
    const message =
      err instanceof Error
        ? err.message || (err as { meta?: { message?: string } }).meta?.message || err.toString()
        : String(err);
    log.warn(`dynamic seed DB query failed (continuing with hardcoded seeds only): ${message}`);
    return [];
  }

  if (rows.length === 0) {
    log.info('No dynamic seed candidates available — hardcoded seeds only');
    return [];
  }

  // Run LLM keyword extraction on the center_goals (they look like "titles" to the prompt)
  const titles = rows.map((r) => r.center_goal);
  let extracted;
  try {
    extracted = await extractKeywordsBatch({
      titles,
      ...(opts.ollamaUrl !== undefined ? { baseUrl: opts.ollamaUrl } : {}),
      ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
    });
  } catch (err) {
    log.warn(
      `dynamic seed LLM extract failed (continuing with hardcoded seeds only): ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }

  // Convert to LearningSeed[], dedupe by lowercased term
  const seen = new Set<string>();
  const seeds: LearningSeed[] = [];
  for (const ext of extracted) {
    if (ext.learning_score < DYNAMIC_SEED_LEARNING_THRESHOLD) continue;
    for (const kw of ext.keywords) {
      const normalized = kw.trim();
      if (!normalized) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      seeds.push({ term: normalized, domain: DYNAMIC_SEED_DOMAIN });
    }
  }

  log.info(
    `dynamic seeds: ${rows.length} center_goals → ${extracted.length} extracted → ${seeds.length} unique seed terms`
  );
  return seeds;
}

/**
 * Merge hardcoded + dynamic seeds, dedupe by lowercased term.
 * Hardcoded entries take priority on conflicts (their domain is more specific).
 */
export function mergeSeeds(
  hardcoded: readonly LearningSeed[],
  dynamic: readonly LearningSeed[]
): LearningSeed[] {
  const seen = new Set<string>();
  const merged: LearningSeed[] = [];
  for (const s of hardcoded) {
    const key = s.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(s);
  }
  for (const s of dynamic) {
    const key = s.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(s);
  }
  return merged;
}
