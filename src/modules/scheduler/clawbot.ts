/**
 * ClawbotScheduler — Automated summary generation agent.
 *
 * Periodically scans for unsummarized YouTube videos and runs
 * batch enrichment via child process (enrich-worker.js).
 * Singleton pattern, integrated with server startup/shutdown.
 */

import * as cron from 'node-cron';
import { randomUUID } from 'crypto';
import { fork, ChildProcess } from 'child_process';
import { resolve } from 'path';
import { getPrismaClient } from '../database/client';
import { logger } from '../../utils/logger';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CRON_EXPRESSION = '*/30 * * * *';
const DEFAULT_THRESHOLD = 10;
const DEFAULT_BATCH_LIMIT = 50;
const DEFAULT_DELAY_MS = 3000;
const MAX_RUN_HISTORY = 50;
const STARTUP_DELAY_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 3; // Auto-stop after N consecutive 0-enriched runs

// ============================================================================
// Types
// ============================================================================

export interface ClawbotConfig {
  cronExpression: string;
  threshold: number;
  batchLimit: number;
  delayMs: number;
  autoStart: boolean;
}

export type ClawbotRunStatus = 'running' | 'completed' | 'failed' | 'skipped';
export type ClawbotRunTrigger = 'cron' | 'manual' | 'startup';

export interface ClawbotRunRecord {
  id: string;
  trigger: ClawbotRunTrigger;
  status: ClawbotRunStatus;
  startedAt: string;
  completedAt: string | null;
  unsummarizedCount: number;
  result: {
    total: number;
    enriched: number;
    skipped: number;
    errors: { videoId: string; error: string }[];
  } | null;
  error: string | null;
}

export interface ClawbotStatus {
  enabled: boolean;
  running: boolean;
  config: ClawbotConfig;
  currentRun: ClawbotRunRecord | null;
  lastRun: ClawbotRunRecord | null;
  nextRunEstimate: string | null;
  stats: {
    totalRuns: number;
    totalEnriched: number;
    totalErrors: number;
    totalSkipped: number;
  };
}

// ============================================================================
// ClawbotScheduler
// ============================================================================

export class ClawbotScheduler {
  private config: ClawbotConfig;
  private cronJob: cron.ScheduledTask | null = null;
  private currentRun: ClawbotRunRecord | null = null;
  private runHistory: ClawbotRunRecord[] = [];
  private childProcess: ChildProcess | null = null;
  private enabled = false;
  private consecutiveFailures = 0;

  constructor(config?: Partial<ClawbotConfig>) {
    this.config = {
      cronExpression: config?.cronExpression ?? DEFAULT_CRON_EXPRESSION,
      threshold: config?.threshold ?? DEFAULT_THRESHOLD,
      batchLimit: config?.batchLimit ?? DEFAULT_BATCH_LIMIT,
      delayMs: config?.delayMs ?? DEFAULT_DELAY_MS,
      autoStart: config?.autoStart ?? true,
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.enabled) {
      logger.warn('Clawbot already running');
      return;
    }

    this.enabled = true;

    this.cronJob = cron.schedule(this.config.cronExpression, () => {
      void this.executeRun('cron');
    });

    logger.info('Clawbot summary agent started', {
      cron: this.config.cronExpression,
      threshold: this.config.threshold,
      batchLimit: this.config.batchLimit,
    });

    // Startup run after delay
    setTimeout(() => {
      if (this.enabled) {
        void this.executeRun('startup');
      }
    }, STARTUP_DELAY_MS);
  }

  async stop(): Promise<void> {
    if (!this.enabled) {
      logger.warn('Clawbot not running');
      return;
    }

    this.enabled = false;

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    if (this.childProcess) {
      this.childProcess.kill('SIGTERM');
      this.childProcess = null;
    }

    logger.info('Clawbot summary agent stopped');
  }

  // --------------------------------------------------------------------------
  // Manual trigger
  // --------------------------------------------------------------------------

  async trigger(): Promise<ClawbotRunRecord> {
    if (this.currentRun) {
      throw new Error('A run is already in progress');
    }
    return this.executeRun('manual');
  }

  // --------------------------------------------------------------------------
  // Status & History
  // --------------------------------------------------------------------------

  getStatus(): ClawbotStatus {
    const stats = this.computeStats();
    return {
      enabled: this.enabled,
      running: this.currentRun !== null,
      config: { ...this.config },
      currentRun: this.currentRun,
      lastRun: this.runHistory[0] ?? null,
      nextRunEstimate: this.enabled && this.cronJob ? this.estimateNextRun() : null,
      stats,
    };
  }

  getRunHistory(limit = 20): ClawbotRunRecord[] {
    return this.runHistory.slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Config
  // --------------------------------------------------------------------------

  updateConfig(updates: Partial<ClawbotConfig>): ClawbotConfig {
    if (updates.cronExpression !== undefined) {
      if (!cron.validate(updates.cronExpression)) {
        throw new Error(`Invalid cron expression: ${updates.cronExpression}`);
      }
      this.config.cronExpression = updates.cronExpression;
    }
    if (updates.threshold !== undefined) this.config.threshold = updates.threshold;
    if (updates.batchLimit !== undefined) this.config.batchLimit = updates.batchLimit;
    if (updates.delayMs !== undefined) this.config.delayMs = updates.delayMs;
    if (updates.autoStart !== undefined) this.config.autoStart = updates.autoStart;

    // Restart cron with new expression if running
    if (this.enabled && this.cronJob && updates.cronExpression !== undefined) {
      this.cronJob.stop();
      this.cronJob = cron.schedule(this.config.cronExpression, () => {
        void this.executeRun('cron');
      });
    }

    logger.info('Clawbot config updated', this.config);
    return { ...this.config };
  }

  // --------------------------------------------------------------------------
  // Core execution
  // --------------------------------------------------------------------------

  private async executeRun(trigger: ClawbotRunTrigger): Promise<ClawbotRunRecord> {
    // Mutex — skip if already running
    if (this.currentRun) {
      logger.info('Clawbot run skipped — already running', { trigger });
      const skippedRecord = this.createRunRecord(trigger, 'skipped', 0);
      this.addToHistory(skippedRecord);
      return skippedRecord;
    }

    const runId = randomUUID();
    const run: ClawbotRunRecord = {
      id: runId,
      trigger,
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      unsummarizedCount: 0,
      result: null,
      error: null,
    };

    this.currentRun = run;

    try {
      // 1. Scan unsummarized count
      const count = await this.scanUnsummarizedCount();
      run.unsummarizedCount = count;

      // 2. Check threshold
      if (count < this.config.threshold) {
        run.status = 'skipped';
        run.completedAt = new Date().toISOString();
        logger.info('Clawbot run skipped — below threshold', {
          trigger,
          count,
          threshold: this.config.threshold,
        });
        this.currentRun = null;
        this.addToHistory(run);
        return run;
      }

      // 3. Run enrichment in child process
      logger.info('Clawbot starting enrichment', {
        trigger,
        unsummarized: count,
        batchLimit: this.config.batchLimit,
      });

      const result = await this.runEnrichChildProcess();
      run.status = 'completed';
      run.completedAt = new Date().toISOString();
      run.result = result;

      logger.info('Clawbot run completed', {
        trigger,
        enriched: result.enriched,
        errors: result.errors.length,
      });

      // Circuit breaker: auto-stop after consecutive zero-enrichment runs
      if (result.enriched === 0 && result.errors.length > 0) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.error('Clawbot auto-stopped: too many consecutive failures', {
            consecutiveFailures: this.consecutiveFailures,
            lastErrors: result.errors.slice(0, 3).map((e) => e.error),
          });
          void this.stop();
        }
      } else {
        this.consecutiveFailures = 0;
      }
    } catch (err) {
      run.status = 'failed';
      run.completedAt = new Date().toISOString();
      run.error = err instanceof Error ? err.message : String(err);
      logger.error('Clawbot run failed', { trigger, error: run.error });
    } finally {
      this.currentRun = null;
      this.addToHistory(run);
    }

    return run;
  }

  // --------------------------------------------------------------------------
  // DB scan — lightweight COUNT query
  // --------------------------------------------------------------------------

  private async scanUnsummarizedCount(): Promise<number> {
    const prisma = getPrismaClient();
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count FROM (
        SELECT DISTINCT extract_youtube_vid(c.url) as vid
        FROM public.user_local_cards c
        WHERE c.link_type IN ('youtube', 'youtube-shorts')
          AND extract_youtube_vid(c.url) IS NOT NULL

        UNION

        SELECT DISTINCT yv.youtube_video_id as vid
        FROM public.youtube_videos yv
        WHERE yv.youtube_video_id IS NOT NULL
      ) combined
      WHERE NOT EXISTS (
        SELECT 1 FROM public.video_summaries vs WHERE vs.video_id = combined.vid
      )
    `;

    return Number(rows[0]?.count ?? 0);
  }

  // --------------------------------------------------------------------------
  // Child process — reuses enrich-worker.js
  // --------------------------------------------------------------------------

  private runEnrichChildProcess(): Promise<{
    total: number;
    enriched: number;
    skipped: number;
    errors: { videoId: string; error: string }[];
  }> {
    return new Promise((resolve_, reject) => {
      const workerPath = resolve(__dirname, '../ontology/enrich-worker.js');

      const child = fork(workerPath, [], {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      this.childProcess = child;

      child.send({ limit: this.config.batchLimit, delayMs: this.config.delayMs });

      child.on(
        'message',
        (msg: {
          type: string;
          data: {
            total: number;
            enriched: number;
            skipped: number;
            errors: { videoId: string; error: string }[];
          };
        }) => {
          if (msg.type === 'result') {
            resolve_(msg.data);
          }
        }
      );

      child.on('error', (err) => {
        this.childProcess = null;
        reject(err);
      });

      child.on('exit', (code) => {
        this.childProcess = null;
        if (code !== 0) {
          reject(new Error(`enrich-worker exited with code ${code}`));
        }
      });
    });
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private addToHistory(run: ClawbotRunRecord): void {
    this.runHistory.unshift(run);
    if (this.runHistory.length > MAX_RUN_HISTORY) {
      this.runHistory.length = MAX_RUN_HISTORY;
    }
  }

  private createRunRecord(
    trigger: ClawbotRunTrigger,
    status: ClawbotRunStatus,
    unsummarizedCount: number
  ): ClawbotRunRecord {
    return {
      id: randomUUID(),
      trigger,
      status,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      unsummarizedCount,
      result: null,
      error: null,
    };
  }

  private computeStats() {
    let totalRuns = 0;
    let totalEnriched = 0;
    let totalErrors = 0;
    let totalSkipped = 0;

    for (const run of this.runHistory) {
      totalRuns++;
      if (run.result) {
        totalEnriched += run.result.enriched;
        totalErrors += run.result.errors.length;
        totalSkipped += run.result.skipped;
      }
    }

    return { totalRuns, totalEnriched, totalErrors, totalSkipped };
  }

  private estimateNextRun(): string | null {
    // Simple estimate: parse cron and compute next from now
    try {
      const interval = cron.schedule(this.config.cronExpression, () => {}, { scheduled: false });
      // node-cron doesn't expose nextDate, so estimate manually
      interval.stop();

      // Parse simple */N * * * * patterns
      const match = this.config.cronExpression.match(/^\*\/(\d+)\s/);
      if (match) {
        const minutes = parseInt(match[1]!, 10);
        const now = new Date();
        const next = new Date(now.getTime() + minutes * 60_000);
        return next.toISOString();
      }
      return null;
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ClawbotScheduler | null = null;

export function getClawbot(): ClawbotScheduler {
  if (!instance) {
    instance = new ClawbotScheduler();
  }
  return instance;
}
