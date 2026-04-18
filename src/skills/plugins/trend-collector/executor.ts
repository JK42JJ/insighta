/**
 * trend-collector — executor (3-stage: preflight + execute)
 *
 * Phase 1.5a redesign (CP352):
 *   - PRIMARY source   : YouTube Trending mostPopular → titles → LLM keyword
 *                        extraction (Mac Mini Ollama llama3.1) → topic keywords
 *   - SECONDARY source : YouTube Search Suggest → autocomplete keywords for
 *                        ~30 hardcoded learning seed terms
 *
 * Both sources write to trend_signals as REAL topic keywords (not video titles).
 * Source values: 'youtube_trending_extracted' / 'youtube_suggest'.
 *
 * Phase 1 (deprecated) used 'youtube_trending' with whole video titles as
 * keywords — that was the Q2 design flaw. Old rows should be TRUNCATEd by
 * the smoke runner before re-seeding.
 *
 * Soft-failure modes:
 *   - LLM unreachable → Suggest-only run (status='partial' if Suggest works)
 *   - Suggest blocked → LLM-only run
 *   - BOTH fail       → status='failed', no DB writes
 *
 * Idempotency: upsert by (source, keyword, language). Re-running overwrites
 * the previous day's signals for the same topic.
 */

import type {
  SkillExecutor,
  PreflightContext,
  PreflightResult,
  ExecuteContext,
  ExecuteResult,
} from '@/skills/_shared/types';
import { checkRequiredDependencies } from '@/skills/_shared/runtime';
import { getPrismaClient } from '@/modules/database';
import type { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import {
  manifest,
  TREND_COLLECTOR_DEFAULT_CATEGORY_IDS,
  TREND_COLLECTOR_DEFAULT_REGION_CODE,
  TREND_COLLECTOR_MAX_RESULTS_PER_CATEGORY,
  TREND_COLLECTOR_TTL_DAYS,
  TREND_COLLECTOR_SOURCE_LLM,
  TREND_COLLECTOR_SOURCE_SUGGEST,
  TREND_COLLECTOR_LEARNING_THRESHOLD,
} from './manifest';
import { fetchTrendingByCategory, YouTubeFetchError, type TrendingVideo } from './sources/youtube';
import {
  extractKeywordsBatch,
  LlmExtractError,
  type ExtractedKeyword,
} from './sources/llm-extract';
import {
  fetchSuggestions,
  suggestPositionToScore,
  SuggestFetchError,
  type SuggestionItem,
} from './sources/suggest';
import { LEARNING_SEED_TERMS, type LearningSeed } from './seed-terms';
import { loadDynamicSeedsFromMandalas, mergeSeeds } from './dynamic-seeds';
import { MS_PER_DAY } from '@/utils/time-constants';

const log = logger.child({ module: 'trend-collector' });

const KEYWORD_MAX_LENGTH = 255;
const DEFAULT_OLLAMA_URL = 'http://100.91.173.17:11434';
const SUGGEST_PARALLELISM = 3; // be polite to the unofficial endpoint

interface HydratedState {
  apiKey: string;
  categoryIds: readonly string[];
  regionCode: string;
  maxResults: number;
  llmEnabled: boolean;
  llmUrl: string;
  suggestEnabled: boolean;
  seedTerms: readonly LearningSeed[];
  fetchImpl?: typeof fetch;
}

interface AggregatedKeyword {
  source: string;
  keyword: string;
  rawScore: number;
  metadata: Record<string, unknown>;
}

export const executor: SkillExecutor = {
  manifest,

  async preflight(ctx: PreflightContext): Promise<PreflightResult> {
    const missing = checkRequiredDependencies(manifest, ctx.env);
    if (missing.length > 0) {
      return { ok: false, reason: `Missing required env vars: ${missing.join(', ')}` };
    }

    const apiKey = ctx.env['YOUTUBE_API_KEY'];
    if (!apiKey) {
      return { ok: false, reason: 'YOUTUBE_API_KEY resolved empty after dep check' };
    }

    // LLM extract is OPTIONAL — degrade gracefully if Mac Mini unreachable.
    // Suggest is also optional. Both flags default ON; preflight does NOT
    // probe reachability (that happens at execute time, kept cheap here).
    const llmUrl = ctx.env['OLLAMA_URL'] || DEFAULT_OLLAMA_URL;

    const hydrated: HydratedState = {
      apiKey,
      categoryIds: TREND_COLLECTOR_DEFAULT_CATEGORY_IDS,
      regionCode: TREND_COLLECTOR_DEFAULT_REGION_CODE,
      maxResults: TREND_COLLECTOR_MAX_RESULTS_PER_CATEGORY,
      llmEnabled: true,
      llmUrl,
      suggestEnabled: true,
      seedTerms: LEARNING_SEED_TERMS,
    };

    return { ok: true, hydrated: hydrated as unknown as Record<string, unknown> };
  },

  async execute(ctx: ExecuteContext): Promise<ExecuteResult> {
    const t0 = Date.now();
    const state = ctx.state as unknown as HydratedState;
    const db = getPrismaClient();

    const fetchedAt = new Date();
    const expiresAt = new Date(fetchedAt.getTime() + TREND_COLLECTOR_TTL_DAYS * MS_PER_DAY);

    // ── Phase 0: Dynamic seed expansion (CP353) ────────────────────────
    // Pull a random sample of meaningful user mandala center_goals,
    // LLM-extract topic keywords, and merge with hardcoded seeds. This
    // covers long-tail user goals (향수 브랜드, 분산 시스템, 음악 치료사…)
    // that the 30 hardcoded seeds miss.
    let dynamicSeeds: readonly LearningSeed[] = [];
    let dynamicSeedDurationMs = 0;
    if (state.llmEnabled) {
      const tDyn = Date.now();
      const result = await loadDynamicSeedsFromMandalas({
        ...(state.fetchImpl !== undefined ? { fetchImpl: state.fetchImpl } : {}),
        ollamaUrl: state.llmUrl,
      });
      dynamicSeeds = result;
      dynamicSeedDurationMs = Date.now() - tDyn;
      log.info(`dynamic seeds loaded: +${dynamicSeeds.length} terms in ${dynamicSeedDurationMs}ms`);
    }
    const effectiveSeeds = mergeSeeds(state.seedTerms, dynamicSeeds);

    // ── Phase A: Trending fetch ────────────────────────────────────────
    const allVideos: TrendingVideo[] = [];
    const trendingErrors: { categoryId: string; error: string }[] = [];
    const emptyCategories: string[] = [];

    for (const categoryId of state.categoryIds) {
      try {
        const items = await fetchTrendingByCategory({
          apiKey: state.apiKey,
          categoryId,
          regionCode: state.regionCode,
          maxResults: state.maxResults,
          fetchImpl: state.fetchImpl,
        });
        allVideos.push(...items);
      } catch (err) {
        if (err instanceof YouTubeFetchError && err.httpStatus === 404) {
          emptyCategories.push(categoryId);
          continue;
        }
        const message =
          err instanceof YouTubeFetchError
            ? `${err.message}${err.youtubeMessage ? ` — ${err.youtubeMessage}` : ''}`
            : err instanceof Error
              ? err.message
              : String(err);
        log.warn(`Category ${categoryId} failed: ${message}`);
        trendingErrors.push({ categoryId, error: message });
      }
    }

    // ── Phase B: LLM keyword extraction (PRIMARY) ──────────────────────
    const llmKeywords: AggregatedKeyword[] = [];
    let llmExtracted: ExtractedKeyword[] = [];
    let llmDurationMs = 0;
    let llmFailed = false;
    if (state.llmEnabled && allVideos.length > 0) {
      const titles = allVideos.map((v) => v.title);
      const tLlm = Date.now();
      try {
        llmExtracted = await extractKeywordsBatch({
          titles,
          baseUrl: state.llmUrl,
          fetchImpl: state.fetchImpl,
        });
        llmDurationMs = Date.now() - tLlm;
        log.info(`LLM extracted keywords from ${titles.length} titles in ${llmDurationMs}ms`);
      } catch (err) {
        llmFailed = true;
        log.warn(
          `LLM extract failed (continuing with Suggest only): ${err instanceof LlmExtractError ? err.message : String(err)}`
        );
      }

      // Aggregate by keyword: same keyword from multiple videos → sum view counts
      // Drop entries below the learning_score threshold (entertainment filter).
      const keywordMap = new Map<
        string,
        {
          rawScore: number;
          videoIds: string[];
          learningScores: number[];
          firstCategory: string;
        }
      >();
      for (let i = 0; i < llmExtracted.length; i++) {
        const ext = llmExtracted[i];
        const video = allVideos[i];
        if (!ext || !video) continue;
        if (ext.learning_score < TREND_COLLECTOR_LEARNING_THRESHOLD) continue;

        for (const rawKeyword of ext.keywords) {
          const keyword = truncateKeyword(rawKeyword);
          if (!keyword) continue;
          const existing = keywordMap.get(keyword);
          if (existing) {
            existing.rawScore += video.viewCount;
            existing.videoIds.push(video.videoId);
            existing.learningScores.push(ext.learning_score);
          } else {
            keywordMap.set(keyword, {
              rawScore: video.viewCount,
              videoIds: [video.videoId],
              learningScores: [ext.learning_score],
              firstCategory: video.categoryId,
            });
          }
        }
      }

      for (const [keyword, agg] of keywordMap) {
        const avgLearning =
          agg.learningScores.reduce((a, b) => a + b, 0) / agg.learningScores.length;
        llmKeywords.push({
          source: TREND_COLLECTOR_SOURCE_LLM,
          keyword,
          rawScore: agg.rawScore,
          metadata: {
            video_ids: agg.videoIds,
            video_count: agg.videoIds.length,
            avg_learning_score: avgLearning,
            primary_category: agg.firstCategory,
          },
        });
      }
    }

    // ── Phase C: Suggest API (SECONDARY) ───────────────────────────────
    const suggestKeywords: AggregatedKeyword[] = [];
    let suggestSucceeded = 0;
    let suggestFailed = 0;
    let suggestDurationMs = 0;
    if (state.suggestEnabled && effectiveSeeds.length > 0) {
      const tSugg = Date.now();
      // Process in small parallel batches to be polite to the unofficial endpoint
      for (let i = 0; i < effectiveSeeds.length; i += SUGGEST_PARALLELISM) {
        const batch = effectiveSeeds.slice(i, i + SUGGEST_PARALLELISM);
        const results = await Promise.all(
          batch.map(async (seed) => {
            try {
              const sugg = await fetchSuggestions({
                query: seed.term,
                fetchImpl: state.fetchImpl,
              });
              return { seed, sugg, error: null as Error | null };
            } catch (err) {
              return {
                seed,
                sugg: [] as SuggestionItem[],
                error: err instanceof Error ? err : new Error(String(err)),
              };
            }
          })
        );

        for (const { seed, sugg, error } of results) {
          if (error) {
            suggestFailed += 1;
            log.warn(
              `Suggest seed "${seed.term}" failed: ${error instanceof SuggestFetchError ? error.message : String(error)}`
            );
            continue;
          }
          suggestSucceeded += 1;
          for (const item of sugg) {
            const keyword = truncateKeyword(item.text);
            if (!keyword) continue;
            suggestKeywords.push({
              source: TREND_COLLECTOR_SOURCE_SUGGEST,
              keyword,
              rawScore: suggestPositionToScore(item.position),
              metadata: {
                seed_term: seed.term,
                seed_domain: seed.domain,
                position: item.position,
              },
            });
          }
        }
      }
      suggestDurationMs = Date.now() - tSugg;
      log.info(
        `Suggest collected ${suggestKeywords.length} keywords from ${suggestSucceeded}/${effectiveSeeds.length} seeds (hardcoded=${state.seedTerms.length}, dynamic=${dynamicSeeds.length}) in ${suggestDurationMs}ms`
      );
    }

    // ── Phase D: Aggregate, normalize, upsert ──────────────────────────
    const allRows = [...llmKeywords, ...suggestKeywords];
    if (allRows.length === 0) {
      return {
        status: 'failed',
        data: {
          videos_fetched: allVideos.length,
          llm_failed: llmFailed,
          suggest_failed_seeds: suggestFailed,
          trending_errors: trendingErrors,
          empty_categories: emptyCategories,
        },
        error: 'Both primary (LLM) and secondary (Suggest) sources produced 0 keywords',
        metrics: { duration_ms: Date.now() - t0 },
      };
    }

    // Per-source min-max normalization (Suggest already in [0.05, 1] so no-op)
    normalizeWithinSource(allRows);

    let inserted = 0;
    let upsertErrors = 0;
    for (const row of allRows) {
      try {
        await db.trend_signals.upsert({
          where: {
            source_keyword_language: {
              source: row.source,
              keyword: row.keyword,
              language: 'ko',
            },
          },
          create: {
            source: row.source,
            keyword: row.keyword,
            language: 'ko',
            domain: null,
            raw_score: row.rawScore,
            norm_score: getNormScore(row),
            velocity: 0,
            metadata: row.metadata as Prisma.InputJsonValue,
            fetched_at: fetchedAt,
            expires_at: expiresAt,
          },
          update: {
            raw_score: row.rawScore,
            norm_score: getNormScore(row),
            velocity: 0,
            metadata: row.metadata as Prisma.InputJsonValue,
            fetched_at: fetchedAt,
            expires_at: expiresAt,
          },
        });
        inserted += 1;
      } catch (err) {
        upsertErrors += 1;
        log.warn(
          `trend_signals upsert failed for "${row.keyword.slice(0, 40)}…": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const status: ExecuteResult['status'] =
      upsertErrors === 0 && inserted > 0 ? 'success' : inserted > 0 ? 'partial' : 'failed';

    return {
      status,
      data: {
        videos_fetched: allVideos.length,
        empty_categories: emptyCategories.length > 0 ? emptyCategories : undefined,
        trending_errors: trendingErrors.length > 0 ? trendingErrors : undefined,
        llm_enabled: state.llmEnabled && !llmFailed,
        llm_keywords: llmKeywords.length,
        llm_extracted_titles: llmExtracted.length,
        llm_duration_ms: llmDurationMs,
        suggest_enabled: state.suggestEnabled,
        suggest_keywords: suggestKeywords.length,
        suggest_succeeded_seeds: suggestSucceeded,
        suggest_failed_seeds: suggestFailed,
        suggest_duration_ms: suggestDurationMs,
        total_signals_upserted: inserted,
        upsert_errors: upsertErrors,
      },
      metrics: {
        duration_ms: Date.now() - t0,
        rows_written: { trend_signals: inserted },
      },
    };
  },
};

/**
 * Min-max normalize raw_score within each source independently.
 * Mutates the rows in place by attaching __norm to the metadata-adjacent slot.
 *
 * Suggest scores are already in [0.05, 1] so they're untouched.
 * LLM-aggregated scores (sum of view counts) need normalization to [0, 1].
 */
function normalizeWithinSource(rows: AggregatedKeyword[]): void {
  // Group by source
  const bySource = new Map<string, AggregatedKeyword[]>();
  for (const row of rows) {
    const arr = bySource.get(row.source);
    if (arr) arr.push(row);
    else bySource.set(row.source, [row]);
  }

  for (const [source, sourceRows] of bySource) {
    if (source === TREND_COLLECTOR_SOURCE_SUGGEST) {
      // Already in [0.05, 1] from suggestPositionToScore — passthrough
      for (const r of sourceRows) {
        (r as { _normScore?: number })._normScore = r.rawScore;
      }
      continue;
    }
    // LLM source: min-max within batch
    const max = Math.max(...sourceRows.map((r) => r.rawScore));
    const safeMax = max > 0 ? max : 1;
    for (const r of sourceRows) {
      (r as { _normScore?: number })._normScore = r.rawScore / safeMax;
    }
  }
}

function getNormScore(row: AggregatedKeyword): number {
  return (row as { _normScore?: number })._normScore ?? 0;
}

function truncateKeyword(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= KEYWORD_MAX_LENGTH) return trimmed;
  return trimmed.slice(0, KEYWORD_MAX_LENGTH);
}
