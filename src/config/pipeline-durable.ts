/**
 * Pipeline durability gate (P0 incident 2026-07-10).
 *
 * The mandala post-creation VIDEO pipeline (embeddings → discover → auto-add,
 * driving recommendation_cache) ran fire-and-forget via `setImmediate` — an
 * in-process promise that DIES on any container restart (deploy, redeploy,
 * crash). A restart 12s into a run left the mandala with 0 cards, the run
 * stuck at status=running, and no retry — the exact durability hole that
 * `mandala-actions-fill` was migrated to pg-boss to close, but the video
 * pipeline was left behind.
 *
 * PIPELINE_DURABLE_ENABLED=true routes the pipeline through a pg-boss job
 * (persists across restarts + 2 backoff retries) plus an orphaned-run
 * watchdog. Unset/false = legacy `setImmediate` path (no-op default → the
 * flag alone rolls back, no code revert).
 *
 * Tuning knob, not a secret (CP392): code default + env override, unset =
 * existing behavior.
 */
export function isPipelineDurableEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['PIPELINE_DURABLE_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}
