/**
 * T7 — precompute attach (matrix 2026-07-12 §11-b).
 *
 * When the wizard consume poll (6s) expires while the precompute is still
 * running, legacy behavior re-runs the FULL discover pipeline: 21-43s to
 * first card + a duplicate YouTube quota spend for work the precompute
 * finishes seconds later anyway (measured: marathon missed done by ~6s,
 * JLPT by ~12s). Attach instead: a detached watcher waits for the row to
 * turn done and re-consumes it; pipeline step2 skips while a YOUNG
 * precompute is in flight so the quota is spent once.
 *
 * Default OFF (unset = legacy re-run). Rollback: flag flip, no code revert.
 */
export function isPrecomputeAttachEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['PRECOMPUTE_ATTACH_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** Watcher gives the precompute this long past consume-miss before falling back. */
export const ATTACH_BUDGET_MS = 30_000;
export const ATTACH_POLL_INTERVAL_MS = 500;

/**
 * Discover step2 skips only while the in-flight precompute row is younger
 * than this — old enough rows mean the precompute is anomalous (post-T6 p95
 * is ~9s) and the pipeline must own placement again. Keep this well below
 * ATTACH_BUDGET_MS so the watcher's fallback re-trigger never dead-ends on
 * its own skip condition.
 */
export const ATTACH_INFLIGHT_MAX_AGE_MS = 20_000;
