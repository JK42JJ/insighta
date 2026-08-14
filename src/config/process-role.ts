/**
 * Process role — which background work this process is responsible for.
 *
 * Every api process currently starts three things: the HTTP listener, the
 * pg-boss workers, and the node-cron schedulers. With one container that is
 * fine. With two it is not: the pg-boss side is arbitrated by the database
 * and collapses correctly across processes, but the node-cron side is
 * guarded only by in-process variables, so every schedule fires once per
 * replica. `AutoSyncScheduler` is on by default and syncs each playlist,
 * so a second replica means each playlist syncs twice and both processes
 * race `backfillOrphanSchedules()` against `sync_schedules`.
 *
 * These two flags let one deployment be split into web processes that serve
 * HTTP and worker processes that consume the queue and hold the schedulers.
 *
 * Both default to TRUE — unset reproduces today's behaviour exactly, so the
 * existing compose deployment is unaffected and the split rolls back by
 * removing the environment variables rather than reverting code.
 *
 *   web pods     RUN_QUEUE_WORKERS=false  RUN_SCHEDULERS=false
 *   worker pods  (defaults, or explicitly true)
 *
 * Tuning knob, not a secret: safe in logs and in a public repository.
 */

function readBool(raw: string | undefined, fallback: boolean): boolean {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === '') return fallback;
  if (v === 'false' || v === '0' || v === 'no') return false;
  if (v === 'true' || v === '1' || v === 'yes') return true;
  return fallback;
}

/**
 * Whether this process registers pg-boss workers and consumes the job queue.
 *
 * Safe to run in several processes at once — pg-boss hands each job to one
 * consumer. Turning it off in web pods keeps the scarce session-mode
 * database connections pg-boss needs on the worker deployment only.
 */
export function runsQueueWorkers(env: NodeJS.ProcessEnv = process.env): boolean {
  return readBool(env['RUN_QUEUE_WORKERS'], true);
}

/**
 * Whether this process starts the node-cron schedulers, `AutoSyncScheduler`
 * among them.
 *
 * NOT safe to run in several processes at once. Exactly one process in the
 * deployment may have this on until the schedules move to pg-boss.
 */
export function runsSchedulers(env: NodeJS.ProcessEnv = process.env): boolean {
  return readBool(env['RUN_SCHEDULERS'], true);
}

/** One-line summary for the startup log, so the role is visible in kubectl logs. */
export function describeProcessRole(env: NodeJS.ProcessEnv = process.env): string {
  return `queueWorkers=${runsQueueWorkers(env)} schedulers=${runsSchedulers(env)}`;
}

/**
 * Port the worker answers probes on. Not the application port: a worker
 * serves no application traffic, only /health and /health/ready.
 */
export function workerProbePort(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(String(env['WORKER_PORT'] ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 3001;
}

export function workerProbeHost(env: NodeJS.ProcessEnv = process.env): string {
  const v = String(env['WORKER_HOST'] ?? '').trim();
  return v === '' ? '0.0.0.0' : v;
}
