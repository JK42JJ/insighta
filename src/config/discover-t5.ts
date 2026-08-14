/**
 * T5 supply/quality knobs (2026-07-12, archetype experiment T5 —
 * docs/handoffs/version-archetype-matrix-2026-07-12.md).
 *
 * Measured basis (run 1710a7c8, James manual, T4/MISS): supply 181 → shorts
 * ate 96 (53%) → gate-in 30 → 11 cards. Rule (concat) queries returned 0-7
 * items each (mostly 0) while LLM queries returned 50 each. The 50-70 card
 * bar is unreachable without ~2-3x effective long-form supply.
 *
 * 1. V3_SEARCH_VIDEO_DURATION — search.list `videoDuration` param
 *    ('medium' = 4-20min). v1 executor always sent medium
 *    (video-discover/executor.ts:1393); the v2/v3 rewrite dropped it, so
 *    half the harvest arrives as Shorts and is discarded post-hoc. Setting
 *    'medium' makes every harvested item long-form (≈2x effective supply
 *    AND kills the 76-180s Shorts inflow at the source). Unset = legacy
 *    (no param).
 *
 * 2. DISCOVER_SKIP_RULE_QUERIES — skip the rule/concat query round
 *    ("{centerGoal} {token}" strings that YouTube matches poorly). LLM
 *    queries + the zero-hit fallback remain. Saves ~10 search.list units
 *    per run and shortens discover (helping precompute HIT rate). Unset =
 *    legacy (rule round runs).
 *
 * Tuning knobs, not secrets (CP392): code default = legacy, flag alone
 * rolls back.
 */
export type SearchVideoDuration = 'short' | 'medium' | 'long';

export function getSearchVideoDuration(
  env: NodeJS.ProcessEnv = process.env
): SearchVideoDuration | null {
  const v = String(env['V3_SEARCH_VIDEO_DURATION'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'medium' || v === 'long' || v === 'short' ? v : null;
}

export function isSkipRuleQueriesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['DISCOVER_SKIP_RULE_QUERIES'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}
