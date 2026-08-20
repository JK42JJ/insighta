/**
 * A process that enqueues starts pg-boss, even when it runs no handlers
 * (regression, 2026-08-19).
 *
 * The web/worker split set RUN_QUEUE_WORKERS=false on the api pods so the
 * node-cron schedulers and pg-boss consumers would run in exactly one place.
 * That part was right. What went with it was `initJobQueue()` itself, and the
 * api is what serves the endpoints that enqueue -- pg-boss `send()` throws
 * unless the client has been started.
 *
 * Measured in production on 2026-08-19:
 *
 *   POST /api/v1/internal/skills/batch-video-collector/run   -> 500 in 0.3s
 *   POST /api/v1/internal/pool-maintenance/run               -> 500
 *   api log: "enqueue failed: JobQueue not started. Call start() first."
 *
 * Both scheduled workflows had been failing nightly. The 500 arrives in a
 * third of a second, so it looked nothing like the ingress timeout that was
 * taking down the collectors beside them, and it was hidden among those.
 */
import * as fs from 'fs';
import * as path from 'path';
import { QUEUE_CONFIG } from '../../src/modules/queue/types';

describe('queue producer role', () => {
  it('a producer pool is bounded well below the worker pool', () => {
    // pg-boss defaults to 10 and opens its own pool, separate from Prisma's.
    // Three api replicas at the default would be 30 session-mode connections
    // against a Supabase limit of 60.
    expect(QUEUE_CONFIG.PRODUCER_POOL_MAX).toBeGreaterThan(0);
    expect(QUEUE_CONFIG.PRODUCER_POOL_MAX).toBeLessThan(QUEUE_CONFIG.WORKER_POOL_MAX);
    expect(QUEUE_CONFIG.PRODUCER_POOL_MAX).toBeLessThan(10);
  });

  it('the whole fleet fits in the connection budget', () => {
    // Stated in charts/insighta/environments/prod.yaml. Written as a sum so a
    // later change to any term has to face the total.
    const API_REPLICAS = 3;
    const PRISMA_POOL_LIMIT = 8;
    const SUPABASE_LIMIT = 60;

    const prisma = API_REPLICAS * PRISMA_POOL_LIMIT + PRISMA_POOL_LIMIT; // api + worker
    const pgboss = API_REPLICAS * QUEUE_CONFIG.PRODUCER_POOL_MAX + QUEUE_CONFIG.WORKER_POOL_MAX;

    expect(prisma + pgboss).toBeLessThan(SUPABASE_LIMIT);
  });

  it('startBackgroundWork does not gate the queue on the worker flag', () => {
    // Read as source rather than imported: importing the queue module pulls in
    // the runtime config, which needs a populated environment. What is being
    // pinned is the wiring, and the wiring is visible in the text.
    const bg = fs.readFileSync(path.join(__dirname, '../../src/api/background.ts'), 'utf-8');
    // The defect was `if (runsQueueWorkers()) { await initJobQueue(); }`.
    expect(bg).toMatch(/initJobQueue\(\{\s*registerWorkers:\s*runsQueueWorkers\(\)\s*\}\)/);
    expect(bg).not.toMatch(/if\s*\(runsQueueWorkers\(\)\)\s*\{[^}]*initJobQueue\(\)/s);
  });

  it('start() distinguishes the two roles', () => {
    const mgr = fs.readFileSync(
      path.join(__dirname, '../../src/modules/queue/manager.ts'),
      'utf-8'
    );
    // Option names are from pg-boss 9.0.3 types.d.ts. A producer runs neither
    // the supervisor nor the scheduler: those maintain one shared database and
    // do not need doing once per api replica.
    expect(mgr).toMatch(/producerOnly/);
    expect(mgr).toMatch(/noSupervisor:\s*true/);
    expect(mgr).toMatch(/noScheduling:\s*true/);
    expect(mgr).toMatch(/max:\s*producerOnly\s*\?/);
  });
});
