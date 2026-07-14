/**
 * V2 auto-enrich gate (T6 round, 2026-07-12). Controls the wizard-creation
 * bulk v2 chain (enrich-video jobs + trigger-level book fill). Default TRUE —
 * unset keeps today's behavior; only an explicit false/0/no pauses the chain
 * (cost-control during E2E test windows, James 2026-07-12). Judge deboost is
 * NOT gated by this — it stays on its own JUDGE_DEBOOST_ENABLED flag.
 */
export function isV2AutoEnrichEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['V2_AUTO_ENRICH_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no');
}
