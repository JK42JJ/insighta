// ③ deck-build — slidegen /slides/build job client.
//
// Async job protocol (same shape as numerize-client; deck build runs minutes):
//   POST /slides/build        { book_json, figures } → { job_id }
//   GET  /slides/build/status ?job_id                → { status, progress_pct, failure_stage }
//   GET  /slides/build/result ?job_id                → .pptx BYTES (binary)
//
// slidegen (Mac Mini) returns the .pptx bytes unchanged — insighta uploads them
// to Supabase Storage itself (no S3 creds on the Mac Mini). Reuses
// SNAPSHOT_SERVICE_URL + token (same :8077 service as numerize).
//
// Honest fail: returns null on unset/non-2xx/no job_id/failed/timeout/empty body
// — NEVER fabricates a deck. The caller then marks the deck failed.

import { loadSnapshotConfig } from '@/config/snapshot';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'deck/slides-build-client' });

const POLL_INTERVAL_MS = 5_000;
const PER_REQUEST_TIMEOUT_MS = 20_000;
// Fetching the .pptx bytes can be larger/slower than a status ping.
const RESULT_TIMEOUT_MS = 60_000;
// Deck build (assemble → render) is the slowest step; long overall budget
// (under the pg-boss DECK_BUILD_OPTIONS.expireInMinutes=15).
const BUILD_BUDGET_MS = 12 * 60 * 1000;

interface JobStatus {
  status?: string;
  progress_pct?: number;
  failure_stage?: string | null;
  stage?: string | null;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function jsonGet(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers, ...init, signal: controller.signal });
    if (!resp.ok) return { ok: false, status: resp.status, body: null };
    return { ok: true, status: resp.status, body: await resp.json() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a deck from book_json + figures. Returns the .pptx bytes (Buffer), or
 * null on any failure (honest — the caller marks the deck failed). `onProgress`
 * is invoked with the slidegen progress_pct on each poll (drives the FE spinner).
 */
export async function buildDeck(
  bookJson: unknown,
  figures: unknown[],
  onProgress?: (pct: number, stage: string | null) => void
): Promise<Buffer | null> {
  const cfg = loadSnapshotConfig();
  if (!cfg.enabled) {
    log.warn('slides-build: service disabled (no SNAPSHOT_SERVICE_TOKEN) — cannot build');
    return null;
  }
  const base = cfg.serviceUrl.replace(/\/$/, '');
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${cfg.serviceToken}`,
  };
  const deadline = Date.now() + BUILD_BUDGET_MS;

  try {
    const post = await jsonGet(`${base}/slides/build`, headers, {
      method: 'POST',
      body: JSON.stringify({ book_json: bookJson, figures }),
    });
    if (!post.ok) {
      log.warn('slides-build: submit non-2xx', { status: post.status });
      return null;
    }
    const jobId = (post.body as { job_id?: unknown })?.job_id;
    if (typeof jobId !== 'string' || jobId.length === 0) {
      log.warn('slides-build: no job_id in submit response');
      return null;
    }

    const statusUrl = `${base}/slides/build/status?job_id=${encodeURIComponent(jobId)}`;
    let done = false;
    for (;;) {
      const s = await jsonGet(statusUrl, headers);
      if (s.ok) {
        const st = s.body as JobStatus;
        if (typeof st.progress_pct === 'number') onProgress?.(st.progress_pct, st.stage ?? null);
        if (st.status === 'done') {
          done = true;
          break;
        }
        if (st.status === 'failed' || st.status === 'error') {
          log.warn('slides-build: job failed', {
            jobId,
            failureStage: st.failure_stage ?? st.stage ?? null,
          });
          return null;
        }
      }
      if (Date.now() >= deadline) break;
      await sleep(POLL_INTERVAL_MS);
    }
    if (!done) {
      log.warn('slides-build: poll timed out', { jobId, budgetMs: BUILD_BUDGET_MS });
      return null;
    }

    // result = .pptx bytes (binary, not JSON).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RESULT_TIMEOUT_MS);
    try {
      const resp = await fetch(`${base}/slides/build/result?job_id=${encodeURIComponent(jobId)}`, {
        headers: { authorization: headers.authorization },
        signal: controller.signal,
      });
      if (!resp.ok) {
        log.warn('slides-build: result non-2xx', { jobId, status: resp.status });
        return null;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length === 0) {
        log.warn('slides-build: result empty body', { jobId });
        return null;
      }
      log.info('slides-build: done', { jobId, bytes: buf.length });
      return buf;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    log.warn('slides-build: build failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
