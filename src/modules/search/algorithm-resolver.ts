/**
 * CP488 — Search Algorithm Resolver
 *
 * Resolves which search_algorithm_versions row applies to the current run:
 *
 *   1. mandala-level override (user_mandalas.search_algorithm_version)
 *   2. global active row (search_algorithm_versions.is_active = true)
 *   3. hardcoded 'v1-current' id as fallback identifier
 *   4. env-only fallback (existing v3Config zod parse from process.env) when
 *      the DB is unreachable or no matching row exists — guarantees the
 *      executor never blocks on the catalog being absent.
 *
 * Returned parameters are merged through `v3EnvSchema` (zod) so the same
 * static defaults that env-only deploys rely on stay in effect when only a
 * subset of knobs is overridden in JSONB.
 *
 * Design: docs/design/search-quality-overhaul-cp488.md (TBD), spec answered
 * in the conversation transcript before this commit. No additional design
 * doc is shipped in this PR — the table + this module + the admin endpoint
 * stub together are the single source of truth.
 */

import { logger } from '@/utils/logger';
import { getPrismaClient } from '@/modules/database';
import {
  v3Config as v3EnvDefaults,
  v3EnvSchema,
  type V3Config,
} from '@/skills/plugins/video-discover/v3/config';

const log = logger.child({ module: 'search/algorithm-resolver' });

/**
 * Fallback identifier used when no DB row is available.
 * Matches the seed inserted by migration 001_algo_versions_catalog.sql; if a
 * deploy somehow misses that seed the resolver still tags traces with a
 * stable string so SELECT-GROUP-BY does not group NULL-vs-'v1-current' rows
 * apart.
 */
export const FALLBACK_ALGORITHM_ID = 'v1-current';

export interface ResolvedAlgorithm {
  id: string;
  parameters: V3Config;
}

/**
 * Resolve the algorithm to use for (userId, mandalaId).
 *
 * Returns env-default V3Config tagged with FALLBACK_ALGORITHM_ID when:
 *   - mandalaId is undefined (ephemeral / wizard-precompute path)
 *   - DB query throws
 *   - no row matches the resolved id
 *
 * Never throws. Production safety > strict tag accuracy.
 */
export async function resolveAlgorithm(opts: {
  userId?: string | null;
  mandalaId?: string | null;
}): Promise<ResolvedAlgorithm> {
  const prisma = getPrismaClient();

  try {
    // 1. mandala override
    if (opts.mandalaId) {
      const m = await prisma.user_mandalas.findUnique({
        where: { id: opts.mandalaId },
        select: { search_algorithm_version: true },
      });
      if (m?.search_algorithm_version) {
        const row = await prisma.search_algorithm_versions.findUnique({
          where: { id: m.search_algorithm_version },
          select: { id: true, parameters: true },
        });
        if (row) return materialize(row.id, row.parameters);
      }
    }

    // 2. global active
    const active = await prisma.search_algorithm_versions.findFirst({
      where: { is_active: true },
      select: { id: true, parameters: true },
    });
    if (active) return materialize(active.id, active.parameters);

    // 3. seeded fallback by id
    const seeded = await prisma.search_algorithm_versions.findUnique({
      where: { id: FALLBACK_ALGORITHM_ID },
      select: { id: true, parameters: true },
    });
    if (seeded) return materialize(seeded.id, seeded.parameters);
  } catch (err) {
    log.warn(
      `algorithm-resolver DB lookup failed, falling back to env defaults: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 4. env-only fallback — uses the V3Config already loaded at module init.
  return { id: FALLBACK_ALGORITHM_ID, parameters: v3EnvDefaults };
}

/**
 * Parse the JSONB parameters through `v3EnvSchema` so any missing keys fall
 * back to the same defaults env-only deploys would see. The schema expects
 * env-style string inputs; we coerce booleans/numbers/arrays to the string
 * forms zod's preprocessors accept so a single zod parse covers both paths.
 */
function materialize(id: string, parametersJson: unknown): ResolvedAlgorithm {
  if (parametersJson == null || typeof parametersJson !== 'object') {
    log.warn(`algorithm-resolver: ${id} parameters not object — using env defaults`);
    return { id, parameters: v3EnvDefaults };
  }
  const j = parametersJson as Record<string, unknown>;
  const asStr = (v: unknown): string | undefined => {
    if (v == null) return undefined;
    if (Array.isArray(v)) return v.join(',');
    return String(v);
  };
  const envLike: Record<string, string | undefined> = {
    V3_ENABLE_TIER1_CACHE: asStr(j['enableTier1Cache']),
    V3_RECENCY_WEIGHT: asStr(j['recencyWeight']),
    V3_RECENCY_HALF_LIFE_MONTHS: asStr(j['recencyHalfLifeMonths']),
    V3_PUBLISHED_AFTER_DAYS: asStr(j['publishedAfterDays']),
    V3_ENABLE_SEMANTIC_RERANK: asStr(j['enableSemanticRerank']),
    V3_ENABLE_WHITELIST_GATE: asStr(j['enableWhitelistGate']),
    V3_YOUTUBE_SEARCH_TIMEOUT_MS: asStr(j['youtubeSearchTimeoutMs']),
    V3_CENTER_GATE_MODE: asStr(j['centerGateMode']),
    V3_MAX_QUERIES: asStr(j['maxQueries']),
    V3_ENABLE_QUALITY_GATE: asStr(j['enableQualityGate']),
    V3_MIN_VIEW_COUNT: asStr(j['minViewCount']),
    V3_MIN_VIEWS_PER_DAY: asStr(j['minViewsPerDay']),
    V3_SEMANTIC_MAX_CANDIDATES: asStr(j['semanticMaxCandidates']),
    V3_USE_YOUTUBE_RANKING_ONLY: asStr(j['useYoutubeRankingOnly']),
    V3_ENABLE_REDIS_PROVIDER: asStr(j['enableRedisProvider']),
    V3_TIER1_SOURCES: asStr(j['tier1Sources']),
    V3_SEMANTIC_MIN_COSINE: asStr(j['semanticMinCosine']),
    V3_TIER2_OVERFETCH: asStr(j['tier2Overfetch']),
  };

  const parsed = v3EnvSchema.safeParse(envLike);
  if (!parsed.success) {
    log.warn(`algorithm-resolver: ${id} zod parse failed — using env defaults`);
    return { id, parameters: v3EnvDefaults };
  }
  // Index-signature bracket access keeps strict TS happy without hand-listing
  // every key in a type assertion. Field renames are mechanical (env → camel).
  const d = parsed.data as Record<string, unknown>;
  const cfg: V3Config = {
    enableTier1Cache: d['V3_ENABLE_TIER1_CACHE'] as boolean,
    recencyWeight: d['V3_RECENCY_WEIGHT'] as number,
    recencyHalfLifeMonths: d['V3_RECENCY_HALF_LIFE_MONTHS'] as number,
    publishedAfterDays: d['V3_PUBLISHED_AFTER_DAYS'] as number,
    enableSemanticRerank: d['V3_ENABLE_SEMANTIC_RERANK'] as boolean,
    semanticAlpha: d['V3_SEMANTIC_ALPHA'] as number,
    semanticBeta: d['V3_SEMANTIC_BETA'] as number,
    enableWhitelistGate: d['V3_ENABLE_WHITELIST_GATE'] as boolean,
    youtubeSearchTimeoutMs: d['V3_YOUTUBE_SEARCH_TIMEOUT_MS'] as number,
    centerGateMode: d['V3_CENTER_GATE_MODE'] as V3Config['centerGateMode'],
    maxQueries: d['V3_MAX_QUERIES'] as number,
    enableQualityGate: d['V3_ENABLE_QUALITY_GATE'] as boolean,
    minViewCount: d['V3_MIN_VIEW_COUNT'] as number,
    minViewsPerDay: d['V3_MIN_VIEWS_PER_DAY'] as number,
    semanticMaxCandidates: d['V3_SEMANTIC_MAX_CANDIDATES'] as number,
    useYoutubeRankingOnly: d['V3_USE_YOUTUBE_RANKING_ONLY'] as boolean,
    enableRedisProvider: d['V3_ENABLE_REDIS_PROVIDER'] as boolean,
    tier1Sources: d['V3_TIER1_SOURCES'] as readonly string[],
    semanticMinCosine: d['V3_SEMANTIC_MIN_COSINE'] as number,
    tier2Overfetch: d['V3_TIER2_OVERFETCH'] as boolean,
  };

  return { id, parameters: cfg };
}
