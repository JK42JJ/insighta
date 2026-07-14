/**
 * gA judge deboost gate (2026-07-12). Single-judge DEBOOST only — removal
 * stays forbidden until the two-judge unanimous stack lands (report §7).
 * Unset = off (flag alone rolls back; cards untouched).
 */
export function isJudgeDeboostEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['JUDGE_DEBOOST_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}
