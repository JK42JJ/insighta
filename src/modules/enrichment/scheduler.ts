/**
 * Enrichment Scheduler — Adaptive, self-throttling background enrichment.
 *
 * Periodically probes for unenriched YouTube cards, assesses server health,
 * and processes a small batch with delays between each card.
 *
 * Design principles:
 *   - Prod: Edge Function proxy only (no direct YouTube calls)
 *   - Adaptive batch size based on server health + recent error rate
 *   - CAPTION_FAILED permanently skipped (no-caption videos)
 *   - Circuit breaker: consecutive full failures → pause cycles
 *
 * Policy: docs/CODING_CONVENTIONS.md § 3-5
 */

import { getPrismaClient } from '../database/client';
import { enrichVideo } from '../ontology/enrichment';
import { logger } from '../../utils/logger';

// ============================================================================
// Constants
// ============================================================================

const CYCLE_MS = 30 * 60 * 1000; // 30 minutes between cycles
const HEALTH_TIMEOUT_MS = 2000;
const MAX_BATCH_SIZE = 3;
const DEFAULT_CARD_DELAY_MS = 5000;
const MIN_CARD_DELAY_MS = 3000;
const MAX_CARD_DELAY_MS = 60000;
const SKIP_CYCLES_AFTER_FULL_FAIL = 1;
const CONSECUTIVE_SUCCESS_THRESHOLD = 3;
const DELAY_INCREASE_FACTOR = 1.5;
const DELAY_DECREASE_FACTOR = 0.8;
const MAX_RUN_HISTORY = 30;
const STARTUP_DELAY_MS = 10000; // Wait 10s after server start before first cycle

// ============================================================================
// Types
// ============================================================================

type HealthLevel = 'good' | 'ok' | 'bad';

interface ProbeResult {
  pending: number;
  health: HealthLevel;
  latencyMs: number;
}

interface CycleResult {
  total: number;
  enriched: number;
  skipped: number;
  errors: { videoId: string; error: string }[];
}

interface RunRecord {
  startedAt: string;
  completedAt: string | null;
  pending: number;
  batchSize: number;
  result: CycleResult | null;
  health: HealthLevel;
  skippedReason: string | null;
}

// ============================================================================
// Scheduler
// ============================================================================

export class EnrichmentScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private enabled = false;
  private cardDelayMs = DEFAULT_CARD_DELAY_MS;
  private consecutiveSuccess = 0;
  private skipCyclesRemaining = 0;
  private history: RunRecord[] = [];
  private currentCycle: RunRecord | null = null;

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.enabled) return;
    this.enabled = true;

    logger.info('EnrichmentScheduler starting', {
      cycleMs: CYCLE_MS,
      startupDelay: STARTUP_DELAY_MS,
    });

    // Delay first cycle to let server stabilize
    setTimeout(() => {
      if (!this.enabled) return;
      void this.runCycle();
      this.timer = setInterval(() => void this.runCycle(), CYCLE_MS);
    }, STARTUP_DELAY_MS);
  }

  async stop(): Promise<void> {
    this.enabled = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('EnrichmentScheduler stopped');
  }

  getStatus() {
    const recentErrors = this.history
      .slice(-3)
      .reduce((sum, r) => sum + (r.result?.errors.length ?? 0), 0);
    const recentEnriched = this.history
      .slice(-3)
      .reduce((sum, r) => sum + (r.result?.enriched ?? 0), 0);

    return {
      enabled: this.enabled,
      running: this.running,
      cardDelayMs: this.cardDelayMs,
      consecutiveSuccess: this.consecutiveSuccess,
      skipCyclesRemaining: this.skipCyclesRemaining,
      recentCycles: {
        enriched: recentEnriched,
        errors: recentErrors,
      },
      lastRun: this.history[this.history.length - 1] ?? null,
      currentCycle: this.currentCycle,
      totalRuns: this.history.length,
    };
  }

  getHistory(limit = 10): RunRecord[] {
    return this.history.slice(-limit);
  }

  // --------------------------------------------------------------------------
  // Core Cycle
  // --------------------------------------------------------------------------

  private async runCycle(): Promise<void> {
    if (this.running || !this.enabled) return;

    // Skip cycles after full failure
    if (this.skipCyclesRemaining > 0) {
      this.skipCyclesRemaining--;
      logger.info('EnrichmentScheduler skipping cycle (cooldown)', {
        remaining: this.skipCyclesRemaining,
      });
      return;
    }

    this.running = true;
    const record: RunRecord = {
      startedAt: new Date().toISOString(),
      completedAt: null,
      pending: 0,
      batchSize: 0,
      result: null,
      health: 'good',
      skippedReason: null,
    };
    this.currentCycle = record;

    try {
      // ① Probe
      const probe = await this.probe();
      record.pending = probe.pending;
      record.health = probe.health;

      if (probe.pending === 0) {
        record.skippedReason = 'no pending cards';
        logger.info('EnrichmentScheduler: nothing to enrich');
        return;
      }

      // ② Decide
      const batchSize = this.decideBatchSize(probe);
      record.batchSize = batchSize;

      if (batchSize === 0) {
        record.skippedReason = `health=${probe.health}, latency=${probe.latencyMs}ms`;
        logger.warn('EnrichmentScheduler: skipping cycle (unhealthy)', {
          health: probe.health,
          latencyMs: probe.latencyMs,
        });
        return;
      }

      // ③ Execute
      const result = await this.executeBatch(batchSize);
      record.result = result;

      // ④ Adapt
      this.adapt(result);

      logger.info('EnrichmentScheduler cycle complete', {
        enriched: result.enriched,
        errors: result.errors.length,
        skipped: result.skipped,
        nextDelayMs: this.cardDelayMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record.skippedReason = `cycle error: ${msg}`;
      logger.error('EnrichmentScheduler cycle failed', { error: msg });
    } finally {
      record.completedAt = new Date().toISOString();
      this.running = false;
      this.currentCycle = null;
      this.history.push(record);
      if (this.history.length > MAX_RUN_HISTORY) {
        this.history = this.history.slice(-MAX_RUN_HISTORY);
      }
    }
  }

  // --------------------------------------------------------------------------
  // ① Probe — check pending count + server health
  // --------------------------------------------------------------------------

  private async probe(): Promise<ProbeResult> {
    const prisma = getPrismaClient();

    // Count cards without summaries
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count
      FROM public.user_local_cards c
      WHERE c.link_type IN ('youtube', 'youtube-shorts')
        AND NOT EXISTS (
          SELECT 1 FROM public.video_summaries vs
          WHERE vs.video_id = extract_youtube_vid(c.url)
        )
    `;
    const pending = Number(rows[0]?.count ?? 0);

    // Self health check (API latency)
    const start = Date.now();
    let latencyMs: number;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const port = process.env['PORT'] || '3000';
      await fetch(`http://localhost:${port}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      latencyMs = Date.now() - start;
    } catch {
      latencyMs = HEALTH_TIMEOUT_MS + 1; // Timeout = unhealthy
    }

    // Error rate from recent 3 cycles
    const recent = this.history.slice(-3);
    const totalAttempted = recent.reduce((s, r) => s + (r.result?.total ?? 0), 0);
    const totalErrors = recent.reduce((s, r) => s + (r.result?.errors.length ?? 0), 0);
    const errorRate = totalAttempted > 0 ? totalErrors / totalAttempted : 0;

    let health: HealthLevel;
    if (latencyMs < 500 && errorRate < 0.2) {
      health = 'good';
    } else if (latencyMs < 1500 && errorRate < 0.5) {
      health = 'ok';
    } else {
      health = 'bad';
    }

    logger.info('EnrichmentScheduler probe', { pending, latencyMs, errorRate, health });
    return { pending, health, latencyMs };
  }

  // --------------------------------------------------------------------------
  // ② Decide — batch size based on health
  // --------------------------------------------------------------------------

  private decideBatchSize(probe: ProbeResult): number {
    switch (probe.health) {
      case 'good':
        return Math.min(MAX_BATCH_SIZE, probe.pending);
      case 'ok':
        return Math.min(1, probe.pending);
      case 'bad':
        return 0;
    }
  }

  // --------------------------------------------------------------------------
  // ③ Execute — process cards one by one with delay
  // --------------------------------------------------------------------------

  private async executeBatch(batchSize: number): Promise<CycleResult> {
    const prisma = getPrismaClient();

    // Fetch unenriched YouTube cards (excluding permanently skipped)
    const cards = await prisma.$queryRaw<{ vid: string; title: string; url: string }[]>`
      SELECT
        extract_youtube_vid(c.url) as vid,
        COALESCE(c.title, c.metadata_title, 'Untitled') as title,
        c.url
      FROM public.user_local_cards c
      WHERE c.link_type IN ('youtube', 'youtube-shorts')
        AND extract_youtube_vid(c.url) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.video_summaries vs
          WHERE vs.video_id = extract_youtube_vid(c.url)
        )
      ORDER BY c.created_at ASC
      LIMIT ${batchSize}
    `;

    const result: CycleResult = { total: cards.length, enriched: 0, skipped: 0, errors: [] };

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]!;
      const videoId = card.vid;

      if (!videoId) {
        result.skipped++;
        continue;
      }

      try {
        await enrichVideo(videoId, { title: card.title, url: card.url });
        result.enriched++;
        logger.info('EnrichmentScheduler: card enriched', {
          videoId,
          progress: `${i + 1}/${cards.length}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ videoId, error: msg });

        // CAPTION_FAILED: mark as permanently skipped (no retries)
        if (msg.startsWith('CAPTION_FAILED')) {
          await this.markNoCaption(videoId, card.title, card.url);
          logger.info('EnrichmentScheduler: marked no-caption (permanent skip)', { videoId });
        }

        // LLM rate limit: stop batch early
        if (msg.includes('rate') || msg.includes('429') || msg.includes('limit')) {
          logger.warn('EnrichmentScheduler: rate limit detected, stopping batch early', {
            videoId,
          });
          break;
        }
      }

      // Delay between cards (skip after last card)
      if (i < cards.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, this.cardDelayMs));
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // ④ Adapt — adjust delay based on results
  // --------------------------------------------------------------------------

  private adapt(result: CycleResult): void {
    const hasErrors = result.errors.length > 0;
    const allFailed = result.enriched === 0 && result.total > 0;

    if (allFailed) {
      // Full failure: increase delay, skip next cycle(s)
      this.cardDelayMs = Math.min(this.cardDelayMs * 2, MAX_CARD_DELAY_MS);
      this.skipCyclesRemaining = SKIP_CYCLES_AFTER_FULL_FAIL;
      this.consecutiveSuccess = 0;
      logger.warn('EnrichmentScheduler: full failure, pausing', {
        skipCycles: this.skipCyclesRemaining,
        nextDelayMs: this.cardDelayMs,
      });
    } else if (hasErrors) {
      // Partial failure: increase delay moderately
      this.cardDelayMs = Math.min(
        Math.round(this.cardDelayMs * DELAY_INCREASE_FACTOR),
        MAX_CARD_DELAY_MS
      );
      this.consecutiveSuccess = 0;
    } else {
      // All success
      this.consecutiveSuccess++;
      if (this.consecutiveSuccess >= CONSECUTIVE_SUCCESS_THRESHOLD) {
        this.cardDelayMs = Math.max(
          Math.round(this.cardDelayMs * DELAY_DECREASE_FACTOR),
          MIN_CARD_DELAY_MS
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Mark a video as having no captions available.
   * Inserts a placeholder row in video_summaries so it's excluded from future scans.
   */
  private async markNoCaption(videoId: string, title: string, url: string): Promise<void> {
    const prisma = getPrismaClient();
    try {
      await prisma.$executeRaw`
        INSERT INTO public.video_summaries (video_id, url, title, summary_en, model, transcript_segments, created_at, updated_at)
        VALUES (${videoId}, ${url}, ${title}, NULL, 'no-caption', 0, now(), now())
        ON CONFLICT (video_id) DO NOTHING
      `;
    } catch (err) {
      logger.warn('Failed to mark no-caption', {
        videoId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: EnrichmentScheduler | null = null;

export function getEnrichmentScheduler(): EnrichmentScheduler {
  if (!instance) {
    instance = new EnrichmentScheduler();
  }
  return instance;
}
