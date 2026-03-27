/**
 * Job Queue Manager — pg-boss wrapper for persistent job scheduling.
 *
 * Uses existing Postgres (Supabase) as backing store. Zero additional infra.
 * pg-boss creates its own `pgboss` schema automatically on first start.
 *
 * Connection: Uses DIRECT_URL (session pooler) when available,
 * falling back to DATABASE_URL. pg-boss needs LISTEN/NOTIFY which
 * requires non-transaction-pooler connections.
 *
 * @see docs/design/job-queue-design.md
 */

import PgBoss from 'pg-boss';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { QUEUE_CONFIG } from './types';

// ============================================================================
// Manager
// ============================================================================

export class JobQueueManager {
  private boss: PgBoss | null = null;
  private started = false;

  /**
   * Get the pg-boss connection string.
   * Prefers DIRECT_URL (session pooler, supports LISTEN/NOTIFY)
   * over DATABASE_URL (transaction pooler via PgBouncer).
   * In local dev both point to the same Postgres instance.
   */
  private getConnectionString(): string {
    const directUrl = config.database.directUrl;
    const databaseUrl = config.database.url;

    // DIRECT_URL is the session pooler — required for pg-boss LISTEN/NOTIFY
    const connStr = directUrl || databaseUrl;

    if (!connStr || connStr.startsWith('file:')) {
      throw new Error(
        'JobQueue requires PostgreSQL. DATABASE_URL or DIRECT_URL must be a postgres:// connection string.'
      );
    }

    // Strip PgBouncer params that break pg-boss
    const url = new URL(connStr);
    url.searchParams.delete('pgbouncer');
    url.searchParams.delete('connection_limit');

    return url.toString();
  }

  /**
   * Initialize and start pg-boss.
   * Creates pgboss schema + tables on first run.
   */
  async start(): Promise<void> {
    if (this.started) return;

    const connectionString = this.getConnectionString();

    this.boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
      monitorStateIntervalSeconds: 30,
      archiveCompletedAfterSeconds: QUEUE_CONFIG.ARCHIVE_COMPLETED_AFTER_DAYS * 86400,
      archiveFailedAfterSeconds: QUEUE_CONFIG.ARCHIVE_FAILED_AFTER_DAYS * 86400,
      deleteAfterDays: 30,
    });

    // Error handling
    this.boss.on('error', (error: Error) => {
      logger.error('pg-boss error', { error: error.message });
    });

    this.boss.on('monitor-states', (states: PgBoss.MonitorStates) => {
      logger.debug('pg-boss monitor', { states });
    });

    try {
      await this.boss.start();
      this.started = true;
      logger.info('JobQueue started (pg-boss)', { schema: 'pgboss' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('JobQueue start failed', { error: msg });
      this.boss = null;
      throw err;
    }
  }

  /**
   * Stop pg-boss gracefully. Waits for active jobs to complete.
   */
  async stop(): Promise<void> {
    if (!this.boss || !this.started) return;

    try {
      await this.boss.stop({ graceful: true, timeout: 10000 });
      logger.info('JobQueue stopped');
    } catch (err) {
      logger.warn('JobQueue stop error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.boss = null;
      this.started = false;
    }
  }

  /**
   * Get the pg-boss instance. Throws if not started.
   */
  getInstance(): PgBoss {
    if (!this.boss || !this.started) {
      throw new Error('JobQueue not started. Call start() first.');
    }
    return this.boss;
  }

  /**
   * Check if the queue is running.
   */
  isRunning(): boolean {
    return this.started;
  }

  /**
   * Get queue health status for admin/monitoring.
   */
  async getStatus(): Promise<{
    running: boolean;
    queues: Record<string, { pending: number }>;
  }> {
    if (!this.boss || !this.started) {
      return { running: false, queues: {} };
    }

    try {
      const queues: Record<string, { pending: number }> = {};

      for (const name of ['enrich-video', 'batch-scan']) {
        const size = await this.boss.getQueueSize(name);
        queues[name] = { pending: size };
      }

      return { running: true, queues };
    } catch {
      return { running: this.started, queues: {} };
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: JobQueueManager | null = null;

export function getJobQueue(): JobQueueManager {
  if (!instance) {
    instance = new JobQueueManager();
  }
  return instance;
}
