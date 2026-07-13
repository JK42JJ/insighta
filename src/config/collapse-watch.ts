/**
 * Collapse-watch thresholds (perf-monitor PR2, design 2026-07-13).
 *
 * One source for the diagnosis endpoint (PR2, 24h window) and the 15-min
 * watch job (PR4, 1h window). Baselines = 2026-07-12~13 measured normals
 * (paint 7-10s / place_off 1-4s / HIT 100% / cards 37-62 / shorts 0);
 * thresholds sit at the collapse band, not the noise band. Supervisor
 * review: re-baseline after 1 week of organic beta traffic.
 *
 * Tuning knobs, not secrets (CP392): code default + env override; every
 * override is optional and unset = the measured default below.
 */

function numEnv(env: NodeJS.ProcessEnv, key: string, dflt: number): number {
  const v = Number(env[key]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

export interface CollapseThresholds {
  /** Per-mandala first-card offset p50 (s). 7/3-era collapse ran 15-23s uniform. */
  placeOffP50MaxSec: number;
  /** Wizard precompute consume-HIT rate. 7/3 collapse = this alone (0%). */
  hitRateMin: number;
  /** Cards per mandala p50. */
  cardsP50Min: number;
  /** Precompute row created→done p95 (s). Inflow-gate era ran 16-51s. */
  precomputeP95MaxSec: number;
  /** Shorts (≤180s) placed into mandalas. Long-form-only harvest ⇒ 0. */
  shortsMax: number;
  /** Semantic gate output/input ratio (v3 fallback path). Marathon slaughter = 0.16. */
  gatePassRatioMin: number;
  /** embed.batch trace latency p95 (ms). DeepInfra hang ran 20-40s. */
  embedP95MaxMs: number;
  /** Judge deboost share of placed cards. JLPT pollution ran 0.59. */
  deboostRateMax: number;
}

export function loadCollapseThresholds(env: NodeJS.ProcessEnv = process.env): CollapseThresholds {
  return {
    placeOffP50MaxSec: numEnv(env, 'COLLAPSE_PLACE_OFF_P50_MAX_SEC', 15),
    hitRateMin: numEnv(env, 'COLLAPSE_HIT_RATE_MIN', 0.5),
    cardsP50Min: numEnv(env, 'COLLAPSE_CARDS_P50_MIN', 20),
    precomputeP95MaxSec: numEnv(env, 'COLLAPSE_PRECOMPUTE_P95_MAX_SEC', 20),
    shortsMax: numEnv(env, 'COLLAPSE_SHORTS_MAX', 1) - 1, // default 0 (numEnv floor is >0)
    gatePassRatioMin: numEnv(env, 'COLLAPSE_GATE_PASS_RATIO_MIN', 0.2),
    embedP95MaxMs: numEnv(env, 'COLLAPSE_EMBED_P95_MAX_MS', 8000),
    deboostRateMax: numEnv(env, 'COLLAPSE_DEBOOST_RATE_MAX', 0.5),
  };
}

// ── alert-state machine (pure — shared by the PR4 watch job + tests) ────────

export function isCollapseWatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['COLLAPSE_WATCH_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** Re-alert suppression per metric (first alert immediate; repeats after cooldown). */
export const ALERT_COOLDOWN_MS = 6 * 3600 * 1000;
/** Unresolved-violation escalation unit (supervisor: daily re-send until resolved). */
export const ALERT_ESCALATION_MS = 24 * 3600 * 1000;

export interface AlertState {
  lastAlertAt: Map<string, number>;
  firstSeenAt: Map<string, number>;
}

export function shouldAlert(
  metric: string,
  now: number,
  state: AlertState
): { alert: boolean; escalationDays: number } {
  const first = state.firstSeenAt.get(metric) ?? now;
  if (!state.firstSeenAt.has(metric)) state.firstSeenAt.set(metric, now);
  const last = state.lastAlertAt.get(metric);
  const escalationDays = Math.floor((now - first) / ALERT_ESCALATION_MS);
  if (last == null || now - last >= ALERT_COOLDOWN_MS) {
    state.lastAlertAt.set(metric, now);
    return { alert: true, escalationDays };
  }
  return { alert: false, escalationDays };
}

/** Drop state for metrics no longer violating so recurrence alerts fresh. */
export function clearResolved(activeMetrics: Set<string>, state: AlertState): void {
  for (const k of [...state.firstSeenAt.keys()]) {
    if (!activeMetrics.has(k)) {
      state.firstSeenAt.delete(k);
      state.lastAlertAt.delete(k);
    }
  }
}
