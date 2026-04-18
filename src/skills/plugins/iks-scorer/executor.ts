/**
 * iks-scorer — executor (3-stage: preflight + execute)
 *
 * Reads trend_signals, looks up the active scoring_weights row, computes
 * IKS for each signal, and upserts into keyword_scores by (keyword, language).
 *
 * Phase 2a behaviour:
 *   - Reads trend_signals where source ∈ {DEFAULT_SOURCES} AND expires_at > now()
 *   - Reads scoring_weights WHERE active = true LIMIT 1
 *   - Calls computeIksResult per signal (pure function from ./scoring)
 *   - Upserts keyword_scores with weight_version captured for drift detection
 *
 * Idempotency: upsert by (keyword, language) — re-running overwrites the
 * previous score for the same keyword. Safe to re-run within the same day.
 */

import type {
  SkillExecutor,
  PreflightContext,
  PreflightResult,
  ExecuteContext,
  ExecuteResult,
} from '@/skills/_shared/types';
import { getPrismaClient } from '@/modules/database';
import { Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';
import { manifest, IKS_SCORER_DEFAULT_SOURCES, IKS_SCORER_TTL_DAYS } from './manifest';
import { MS_PER_DAY } from '@/utils/time-constants';
import { computeIksResult, type SignalForScoring, type IksWeights } from './scoring';
import {
  embedBatch,
  isOllamaReachable,
  loadGlobalCentroid,
  vectorToLiteral,
  MAC_MINI_OLLAMA_DEFAULT_URL,
} from './embedding';

const log = logger.child({ module: 'iks-scorer' });

interface HydratedState {
  sources: readonly string[];
  language: string;
  weights: IksWeights;
  weightVersion: number;
  /** True if Mac Mini Ollama is reachable AND centroid loaded successfully. */
  embeddingMode: boolean;
  /** Resolved Ollama base URL (env override or default). */
  ollamaUrl: string;
  /** Global mandala centroid (4096d). null in degraded mode. */
  centroid: number[] | null;
  /** Test-injected fetch (for executor.test.ts). */
  fetchImpl?: typeof fetch;
}

interface ExecuteParams {
  sources?: string[];
  language?: string;
}

export const executor: SkillExecutor = {
  manifest,

  async preflight(ctx: PreflightContext): Promise<PreflightResult> {
    const params = readParams(ctx);
    const language = params.language ?? 'ko';
    const sources =
      params.sources && params.sources.length > 0 ? params.sources : IKS_SCORER_DEFAULT_SOURCES;

    const db = getPrismaClient();

    // Verify there's at least one signal to score (otherwise execute is a no-op)
    const signalCount = await db.trend_signals.count({
      where: {
        source: { in: [...sources] },
        language,
        expires_at: { gt: new Date() },
      },
    });
    if (signalCount === 0) {
      return {
        ok: false,
        reason: `No fresh trend_signals found for sources=${sources.join(',')} language=${language}. Run trend-collector first.`,
      };
    }

    // Verify active scoring_weights row exists
    const activeWeights = await db.scoring_weights.findFirst({
      where: { active: true },
      orderBy: { version: 'desc' },
    });
    if (!activeWeights) {
      return {
        ok: false,
        reason: 'No active scoring_weights row. Phase 0 seed must run before iks-scorer.',
      };
    }

    const weights: IksWeights = {
      search_demand: activeWeights.search_demand,
      competition: activeWeights.competition,
      trend_velocity: activeWeights.trend_velocity,
      goal_relevance: activeWeights.goal_relevance,
      learning_value: activeWeights.learning_value,
      content_performance: activeWeights.content_performance,
    };

    // Phase 2b: probe Mac Mini Ollama and load global centroid.
    // Both are SOFT requirements — failure → degraded mode (placeholder 0.5).
    const ollamaUrl = ctx.env['OLLAMA_URL'] || MAC_MINI_OLLAMA_DEFAULT_URL;
    let embeddingMode = false;
    let centroid: number[] | null = null;
    if (await isOllamaReachable({ baseUrl: ollamaUrl })) {
      try {
        centroid = await loadGlobalCentroid();
        embeddingMode = centroid !== null;
        if (embeddingMode) {
          log.info(`Phase 2b embedding mode enabled (Ollama=${ollamaUrl}, centroid loaded)`);
        } else {
          log.warn('Centroid load returned null — falling back to placeholder mode');
        }
      } catch (err) {
        log.warn(
          `Centroid load failed — falling back to placeholder: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } else {
      log.warn(`Ollama unreachable at ${ollamaUrl} — goal_relevance will use 0.5 placeholder`);
    }

    const hydrated: HydratedState = {
      sources,
      language,
      weights,
      weightVersion: activeWeights.version,
      embeddingMode,
      ollamaUrl,
      centroid,
    };

    return { ok: true, hydrated: hydrated as unknown as Record<string, unknown> };
  },

  async execute(ctx: ExecuteContext): Promise<ExecuteResult> {
    const t0 = Date.now();
    const state = ctx.state as unknown as HydratedState;
    const db = getPrismaClient();

    const scoredAt = new Date();
    const expiresAt = new Date(scoredAt.getTime() + IKS_SCORER_TTL_DAYS * MS_PER_DAY);

    // Pull all fresh signals across the configured sources/language
    const signals = await db.trend_signals.findMany({
      where: {
        source: { in: [...state.sources] },
        language: state.language,
        expires_at: { gt: new Date() },
      },
      orderBy: { norm_score: 'desc' },
    });

    if (signals.length === 0) {
      return {
        status: 'failed',
        data: { signals_read: 0 },
        error: 'No signals available at execute() time (race with TTL?)',
        metrics: { duration_ms: Date.now() - t0 },
      };
    }

    // De-dup by keyword: when Phase 1.5+ adds multiple sources, the same keyword
    // can appear from each source. Take the highest norm_score row per keyword.
    const byKeyword = new Map<string, SignalForScoring>();
    for (const s of signals) {
      const existing = byKeyword.get(s.keyword);
      const candidate: SignalForScoring = {
        keyword: s.keyword,
        raw_score: s.raw_score,
        norm_score: s.norm_score,
        velocity: s.velocity,
        metadata: s.metadata as Record<string, unknown> | null,
      };
      if (!existing || candidate.norm_score > existing.norm_score) {
        byKeyword.set(s.keyword, candidate);
      }
    }

    // Phase 2b: batch-embed all unique keywords in ONE Mac Mini call.
    // Sequential alternative would be ~40 RTTs; batch is 1 RTT + ~10-30s compute.
    // Skipped entirely in degraded mode (state.embeddingMode === false).
    const keywordOrder = Array.from(byKeyword.keys());
    const embeddingByKeyword = new Map<string, number[]>();
    let embedDurationMs = 0;
    if (state.embeddingMode && state.centroid && keywordOrder.length > 0) {
      const tEmbed = Date.now();
      try {
        const vectors = await embedBatch(keywordOrder, {
          baseUrl: state.ollamaUrl,
          fetchImpl: state.fetchImpl,
        });
        for (let i = 0; i < keywordOrder.length; i++) {
          const k = keywordOrder[i];
          const v = vectors[i];
          if (k && v) embeddingByKeyword.set(k, v);
        }
        embedDurationMs = Date.now() - tEmbed;
        log.info(`Embedded ${embeddingByKeyword.size} keywords in ${embedDurationMs}ms (batch)`);
      } catch (err) {
        log.warn(
          `Batch embed failed — falling back to placeholder for this run: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    let upserted = 0;
    let upsertErrors = 0;
    let embeddingsWritten = 0;
    const sampleScores: { keyword: string; iks_total: number; goal_relevance: number }[] = [];

    for (const [, signal] of byKeyword) {
      const keywordEmbedding = embeddingByKeyword.get(signal.keyword) ?? null;
      const result = computeIksResult(signal, state.weights, {
        keywordEmbedding,
        centroid: state.centroid,
      });
      try {
        await db.keyword_scores.upsert({
          where: {
            keyword_language: {
              keyword: signal.keyword,
              language: state.language,
            },
          },
          create: {
            keyword: signal.keyword,
            language: state.language,
            domain: null,
            iks_total: result.iks_total,
            search_demand: result.search_demand,
            competition: result.competition,
            trend_velocity: result.trend_velocity,
            goal_relevance: result.goal_relevance,
            learning_value: result.learning_value,
            content_performance: result.content_performance,
            weight_version: state.weightVersion,
            scored_at: scoredAt,
            expires_at: expiresAt,
          },
          update: {
            iks_total: result.iks_total,
            search_demand: result.search_demand,
            competition: result.competition,
            trend_velocity: result.trend_velocity,
            goal_relevance: result.goal_relevance,
            learning_value: result.learning_value,
            content_performance: result.content_performance,
            weight_version: state.weightVersion,
            scored_at: scoredAt,
            expires_at: expiresAt,
          },
        });
        upserted += 1;

        // Phase 2b: write embedding via $executeRaw (Prisma doesn't support
        // Unsupported("vector(4096)") in normal upsert).
        if (keywordEmbedding) {
          try {
            const literal = vectorToLiteral(keywordEmbedding);
            await db.$executeRaw(
              Prisma.sql`UPDATE keyword_scores SET embedding = ${literal}::vector WHERE keyword = ${signal.keyword} AND language = ${state.language}`
            );
            embeddingsWritten += 1;
          } catch (err) {
            log.warn(
              `embedding UPDATE failed for "${signal.keyword.slice(0, 40)}…": ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        if (sampleScores.length < 3) {
          sampleScores.push({
            keyword: signal.keyword,
            iks_total: result.iks_total,
            goal_relevance: result.goal_relevance,
          });
        }
      } catch (err) {
        upsertErrors += 1;
        log.warn(
          `keyword_scores upsert failed for "${signal.keyword.slice(0, 40)}…": ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const status: ExecuteResult['status'] =
      upsertErrors === 0 ? 'success' : upserted > 0 ? 'partial' : 'failed';

    return {
      status,
      data: {
        signals_read: signals.length,
        unique_keywords: byKeyword.size,
        keyword_scores_upserted: upserted,
        upsert_errors: upsertErrors,
        weight_version: state.weightVersion,
        embedding_mode: state.embeddingMode,
        embeddings_written: embeddingsWritten,
        embed_duration_ms: embedDurationMs,
        sample_scores: sampleScores,
      },
      metrics: {
        duration_ms: Date.now() - t0,
        rows_written: { keyword_scores: upserted },
      },
    };
  },
};

function readParams(ctx: PreflightContext): ExecuteParams {
  // Phase 2a does not yet wire params through the registry adapter.
  // Tests pass params directly via hand-built ExecuteContext.
  void ctx;
  return {};
}
