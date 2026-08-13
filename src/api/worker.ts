/**
 * Worker entrypoint — consumes the job queue and holds the schedulers, with
 * no application HTTP surface.
 *
 * Runs the same code the api process runs for background work (see
 * background.ts), so the set of jobs and schedules is declared once. What it
 * does not do is serve the application: there are no routes here, only the
 * two probe endpoints Kubernetes needs to tell a live worker from a wedged
 * one.
 *
 * Why this exists: the api process starts HTTP, the pg-boss workers and the
 * node-cron schedulers together. The scheduler half is guarded only by
 * per-process variables, so a second api replica fires every schedule twice.
 * Splitting the roles lets the web tier scale while exactly one worker
 * deployment holds the schedulers.
 *
 *   docker/entrypoint.sh worker   -> node dist/api/worker.js
 *
 * Deliberately started with RUN_QUEUE_WORKERS and RUN_SCHEDULERS at their
 * defaults (both true). Setting RUN_SCHEDULERS=false here would leave
 * nothing running the schedules at all.
 */

import http from 'http';
import { startBackgroundWork, stopBackgroundWork, BackgroundLogger } from './background';
import { runsSchedulers, workerProbePort, workerProbeHost } from '../config/process-role';

const PORT = workerProbePort();
const HOST = workerProbeHost();

const log: BackgroundLogger = {
  info: (msg) => console.log(JSON.stringify({ level: 'info', role: 'worker', msg })),
  warn: (obj, msg) =>
    console.warn(JSON.stringify({ level: 'warn', role: 'worker', msg, detail: String(obj) })),
};

/** Flipped once background work has started; the readiness probe reads it. */
let ready = false;
let shuttingDown = false;

/**
 * Two endpoints, deliberately different:
 *   /health        the process is alive. Used for liveness.
 *   /health/ready  background work started and shutdown has not begun.
 *                  Used for readiness, and goes false the moment SIGTERM
 *                  arrives so nothing new is routed here while draining.
 */
const probes = http.createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', role: 'worker', uptime: process.uptime() }));
    return;
  }
  if (url === '/health/ready') {
    const ok = ready && !shuttingDown;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'ready' : 'not-ready', schedulers: runsSchedulers() }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'worker exposes /health and /health/ready only' }));
});

async function main(): Promise<void> {
  if (!runsSchedulers()) {
    log.warn({}, 'RUN_SCHEDULERS=false on a worker process — no process will run the schedules');
  }

  await startBackgroundWork(log);
  ready = true;

  probes.listen(PORT, HOST, () => {
    log.info(`Worker probes listening on http://${HOST}:${PORT}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received, draining`);

    // Stop answering readiness first so the endpoint controller removes this
    // pod before in-flight work is asked to finish.
    try {
      await new Promise<void>((resolve) => probes.close(() => resolve()));
    } catch {
      /* ignore */
    }

    try {
      await stopBackgroundWork(log);
    } catch {
      /* ignore */
    }

    log.info('Worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((err) => {
  log.warn(err, 'Worker failed to start');
  process.exit(1);
});
