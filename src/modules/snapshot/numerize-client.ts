/**
 * Numerize client (⑤) — calls the pod slidegen-service to extract figures from
 * a video's frames at given timestamps.
 *
 * ASYNC JOB protocol (the sync /numerize 60s wall could not hold the ~222s
 * acquire→frames→select→YOLO+Qwen pipeline — measured live). Contract:
 *   POST /numerize/job        { video_id, ts, mode } → { job_id }
 *   GET  /numerize/job/status ?job_id                → { status, progress_pct, stage, failure_stage }
 *   GET  /numerize/job/result ?job_id                → { job_id, figures[] }
 * Overall budget = cfg.timeoutMs (default 300s); status polled every
 * POLL_INTERVAL_MS until status='done' (or a terminal failure / the deadline).
 *
 * The service (frame fetch via Mac Mini KR-IP + YOLO/Qwen numerize) is slidegen
 * 정본; this client only crosses the boundary via SNAPSHOT_SERVICE_URL + bearer.
 *
 * Interpolation = 0 (hard rule): if the service is unset, unreachable, times
 * out, fails the job, or returns a non-2xx / unparseable body, this returns []
 * — it NEVER fabricates a figure. A missing figure is an absent FigureRef. The
 * caller (get-or-extract) then simply has no row for that ts/kind.
 */

import { loadSnapshotConfig } from '@/config/snapshot';
import { logger } from '@/utils/logger';
import { FIGURE_KINDS, type FigureKind, type FigureRef } from './types';

const log = logger.child({ module: 'snapshot/numerize-client' });

// Status poll cadence. Job runs minutes; tighter polling just adds noise.
const POLL_INTERVAL_MS = 5_000;
// Per-HTTP-call timeout. The job itself is async — individual POST/status/result
// calls return fast; this only guards a hung socket, not the job duration.
const PER_REQUEST_TIMEOUT_MS = 20_000;
// 'dev' rejects vision-API usage (service hard gate); 'live' runs the full
// YOLO+Qwen pipeline that actually produces figures.
const NUMERIZE_MODE = 'live';

interface ServiceFigure {
  kind?: string;
  ts_sec?: number;
  struct?: unknown;
  latex?: string;
  asset_path?: string;
  verification_status?: string;
}

interface JobStatus {
  status?: string;
  progress_pct?: number;
  stage?: string | null;
  failure_stage?: string | null;
}

function isFigureKind(k: unknown): k is FigureKind {
  return typeof k === 'string' && (FIGURE_KINDS as readonly string[]).includes(k);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One HTTP call with a per-call timeout. Returns parsed JSON or a non-ok flag. */
async function jsonCall(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) return { ok: false, status: resp.status, body: null };
    return { ok: true, status: resp.status, body: await resp.json() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract figures for one video at the given timestamps via the async job.
 * Returns only the figures the service actually produced; never invents figures
 * for timestamps it skipped (honest fail).
 */
export async function extractFigures(videoId: string, tsList: number[]): Promise<FigureRef[]> {
  const cfg = loadSnapshotConfig();
  if (!cfg.enabled) {
    // Service not configured ⇒ no live extraction. Cache-only mode (demo).
    log.info('numerize: service disabled, no extraction', { videoId, tsCount: tsList.length });
    return [];
  }
  if (tsList.length === 0) return [];

  const base = cfg.serviceUrl.replace(/\/$/, '');
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${cfg.serviceToken}`,
  };
  const deadline = Date.now() + cfg.timeoutMs;

  try {
    // 1. submit job
    const post = await jsonCall(`${base}/numerize/job`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ video_id: videoId, ts: tsList, mode: NUMERIZE_MODE }),
    });
    if (!post.ok) {
      log.warn('numerize: job submit non-2xx — no figures', { videoId, status: post.status });
      return [];
    }
    const jobId = (post.body as { job_id?: unknown })?.job_id;
    if (typeof jobId !== 'string' || jobId.length === 0) {
      log.warn('numerize: no job_id in submit response', { videoId });
      return [];
    }

    // 2. poll status until done / terminal failure / deadline.
    // Poll first, THEN check the deadline, THEN sleep — so a job that is already
    // done returns without an idle wait, and the deadline is honored after the
    // last poll (never a wasted trailing sleep).
    const statusUrl = `${base}/numerize/job/status?job_id=${encodeURIComponent(jobId)}`;
    let done = false;
    for (;;) {
      const s = await jsonCall(statusUrl, { method: 'GET', headers });
      if (s.ok) {
        const st = s.body as JobStatus;
        if (st.status === 'done') {
          done = true;
          break;
        }
        if (st.status === 'failed' || st.status === 'error') {
          log.warn('numerize: job failed — no figures', {
            videoId,
            jobId,
            failureStage: st.failure_stage ?? st.stage ?? null,
          });
          return [];
        }
      }
      // not done (running, or a transient status error) → retry until the budget runs out
      if (Date.now() >= deadline) break;
      await sleep(POLL_INTERVAL_MS);
    }
    if (!done) {
      log.warn('numerize: job poll timed out — no figures', {
        videoId,
        jobId,
        budgetMs: cfg.timeoutMs,
      });
      return [];
    }

    // 3. fetch result
    const r = await jsonCall(`${base}/numerize/job/result?job_id=${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers,
    });
    if (!r.ok) {
      log.warn('numerize: job result non-2xx — no figures', { videoId, jobId, status: r.status });
      return [];
    }
    const body = r.body as { figures?: ServiceFigure[] };
    const figures = Array.isArray(body?.figures) ? body.figures : [];

    const out: FigureRef[] = [];
    for (const f of figures) {
      if (!isFigureKind(f.kind)) continue; // unknown kind → drop, don't guess
      const tsSec = typeof f.ts_sec === 'number' ? f.ts_sec : NaN;
      if (!Number.isFinite(tsSec)) continue;
      out.push({
        videoId,
        tsSec,
        kind: f.kind,
        ...(f.struct !== undefined ? { struct: f.struct } : {}),
        ...(typeof f.latex === 'string' ? { latex: f.latex } : {}),
        ...(typeof f.asset_path === 'string' ? { assetPath: f.asset_path } : {}),
        verificationStatus:
          typeof f.verification_status === 'string' ? f.verification_status : 'unverified',
        source: 'numerize',
      });
    }
    log.info('numerize: job done', { videoId, jobId, figures: out.length });
    return out;
  } catch (err) {
    // Network / parse / abort ⇒ honest fail, no figures.
    log.warn('numerize: extraction failed — no figures', {
      videoId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
