/**
 * render-figure client (CP505 [CV-NOTE-WIRE]) — calls the slidegen-service
 * POST /render-figure to convert a structured figure (struct) to an SVG string.
 *
 * Contract: body {kind, struct} → {svg: string|null}
 * svg=null = degenerate/unrenderable figure (caller MUST drop the figure).
 *
 * Fail-closed: any error, non-2xx, timeout, or null svg → returns null.
 * CPU render only (no vision pipeline); 20s is generous for SVG generation.
 * Uses the same SNAPSHOT_SERVICE_URL + SNAPSHOT_SERVICE_TOKEN as numerize-client.
 */

import { loadSnapshotConfig } from '@/config/snapshot';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'snapshot/render-figure-client' });

// CPU render is fast; 20s guards a hung socket without being unnecessarily tight.
const RENDER_TIMEOUT_MS = 20_000;

/**
 * Render a figure struct to SVG via the slidegen-service /render-figure endpoint.
 * Returns the SVG string on success, or null if the service is unavailable,
 * the figure is degenerate/unrenderable, or any network/parse error occurs.
 */
export async function renderFigureSvg(kind: string, struct: unknown): Promise<string | null> {
  const cfg = loadSnapshotConfig();
  if (!cfg.enabled) {
    // No service configured → extraction disabled; treat every figure as unrenderable.
    log.debug('render-figure: service disabled', { kind });
    return null;
  }

  const base = cfg.serviceUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);

  try {
    const resp = await fetch(`${base}/render-figure`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.serviceToken}`,
      },
      body: JSON.stringify({ kind, struct }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      log.warn('render-figure: non-2xx response', { kind, status: resp.status });
      return null;
    }

    const body = (await resp.json()) as { svg?: unknown };
    const svg = body?.svg;
    if (typeof svg !== 'string' || svg.length === 0) {
      // Service returned null/empty → degenerate figure (caller drops it).
      log.debug('render-figure: null/empty svg — degenerate figure', { kind });
      return null;
    }
    return svg;
  } catch (err) {
    // Network error, abort (timeout), or JSON parse failure → fail-closed.
    log.warn('render-figure: request failed', {
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
