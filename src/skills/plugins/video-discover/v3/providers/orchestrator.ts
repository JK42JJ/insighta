/**
 * Provider Orchestrator — runs VideoProviders in priority order, merges results.
 *
 * Execution: providers sorted by priority (ascending). Each provider fills
 * remaining budget. Dedup via Map<videoId, best-score> (CC review #512: O(n)).
 *
 * Issue: #512
 */

import { logger } from '@/utils/logger';
import type { VideoProvider, MatchRequest, MatchResult, MatchMeta, VideoCandidate } from './types';

const log = logger.child({ module: 'ProviderOrchestrator' });

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorResult {
  candidates: VideoCandidate[];
  providerMetas: MatchMeta[];
  totalLatencyMs: number;
  totalQuotaUsed: number;
}

// ============================================================================
// Orchestrator
// ============================================================================

export class ProviderOrchestrator {
  private readonly providers: VideoProvider[];

  constructor(providers: VideoProvider[]) {
    this.providers = [...providers].sort((a, b) => a.priority - b.priority);
  }

  async execute(request: MatchRequest): Promise<OrchestratorResult> {
    const t0 = Date.now();
    const providerMetas: MatchMeta[] = [];
    const best = new Map<string, VideoCandidate>();

    const excludeIds = new Set(request.excludeVideoIds);

    for (const provider of this.providers) {
      const remaining = request.budget - best.size;
      if (remaining <= 0) {
        log.info(`Budget exhausted — skipping provider "${provider.id}"`);
        break;
      }

      const health = await provider.health();
      if (!health.available) {
        log.info(`Provider "${provider.id}" unavailable: ${health.lastError}`);
        continue;
      }

      const providerRequest: MatchRequest = {
        ...request,
        budget: remaining,
        excludeVideoIds: excludeIds,
      };

      let result: MatchResult;
      try {
        result = await provider.match(providerRequest);
      } catch (err) {
        log.warn(`Provider "${provider.id}" threw`, {
          error: err instanceof Error ? err.message : String(err),
        });
        providerMetas.push({
          source: provider.id,
          latencyMs: 0,
          candidateCount: 0,
          quotaUsed: 0,
        });
        continue;
      }

      providerMetas.push(result.meta);

      for (const candidate of result.candidates) {
        const existing = best.get(candidate.videoId);
        if (!existing || candidate.relevanceScore > existing.relevanceScore) {
          best.set(candidate.videoId, candidate);
        }
        excludeIds.add(candidate.videoId);
      }

      log.info(`Provider "${provider.id}" returned ${result.candidates.length} candidates`, {
        latencyMs: result.meta.latencyMs,
        quotaUsed: result.meta.quotaUsed,
        totalSoFar: best.size,
      });
    }

    const candidates = [...best.values()].slice(0, request.budget);
    const totalLatencyMs = Date.now() - t0;
    const totalQuotaUsed = providerMetas.reduce((sum, m) => sum + m.quotaUsed, 0);

    log.info('Orchestrator complete', {
      providers: this.providers.map((p) => p.id),
      totalCandidates: candidates.length,
      totalLatencyMs,
      totalQuotaUsed,
    });

    return {
      candidates,
      providerMetas,
      totalLatencyMs,
      totalQuotaUsed,
    };
  }
}
