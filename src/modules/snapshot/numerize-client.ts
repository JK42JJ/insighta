/**
 * Numerize client (⑤) — calls the pod slidegen-service to extract figures from
 * a video's frames at given timestamps.
 *
 * The service (frame fetch via Mac Mini KR-IP + YOLO/Qwen numerize) is slidegen
 * 정본; this client only crosses the boundary via the RunPod proxy pattern
 * (SNAPSHOT_SERVICE_URL + bearer). The exact request body shape is pending a
 * 1-field alignment with slidegen — kept minimal ({ video_id, ts }) and easy to
 * extend.
 *
 * Interpolation = 0 (hard rule): if the service is unset, unreachable, times
 * out, or returns a non-2xx / unparseable body, this returns [] — it NEVER
 * fabricates a figure. A missing figure is an absent FigureRef, never a guessed
 * one. The caller (get-or-extract) then simply has no row for that ts/kind.
 */

import { loadSnapshotConfig } from '@/config/snapshot';
import { logger } from '@/utils/logger';
import { FIGURE_KINDS, type FigureKind, type FigureRef } from './types';

const log = logger.child({ module: 'snapshot/numerize-client' });

interface ServiceFigure {
  kind?: string;
  struct?: unknown;
  latex?: string;
  asset_path?: string;
  verification_status?: string;
}

function isFigureKind(k: unknown): k is FigureKind {
  return typeof k === 'string' && (FIGURE_KINDS as readonly string[]).includes(k);
}

/**
 * Extract figures for one video at the given timestamps. Returns only the
 * figures the service actually produced; never invents figures for timestamps
 * the service skipped (honest fail).
 */
export async function extractFigures(videoId: string, tsList: number[]): Promise<FigureRef[]> {
  const cfg = loadSnapshotConfig();
  if (!cfg.enabled) {
    // Service not configured ⇒ no live extraction. Cache-only mode (demo).
    log.info('numerize: service disabled, no extraction', { videoId, tsCount: tsList.length });
    return [];
  }
  if (tsList.length === 0) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const resp = await fetch(`${cfg.serviceUrl.replace(/\/$/, '')}/numerize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.serviceToken}`,
      },
      body: JSON.stringify({ video_id: videoId, ts: tsList }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      log.warn('numerize: service non-2xx — no figures', { videoId, status: resp.status });
      return []; // honest fail — do not fabricate
    }
    const body = (await resp.json()) as { figures?: Array<ServiceFigure & { ts_sec?: number }> };
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
    return out;
  } catch (err) {
    // Timeout / network / parse error ⇒ honest fail, no figures.
    log.warn('numerize: extraction failed — no figures', {
      videoId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  } finally {
    clearTimeout(timer);
  }
}
