/**
 * pg-boss work options that ACTUALLY parallelize the enrich-rich-summary
 * worker. CP498 PR2. Extracted to a dependency-free module (CP479 pattern) so
 * the wiring is unit-assertable without loading the heavy worker import chain.
 *
 * `teamSize:1` alone left `teamConcurrency` inert: pg-boss fetches
 * `teamSize - in-flight` (= 1) jobs per poll and awaits that one to completion
 * before the next fetch → strictly serial (CP475 "5→10" was a no-op). Keeping N
 * jobs in-flight requires `teamSize:N` + `teamRefill:true` together.
 *
 * ⚠️ This helper only proves the OPTION SHAPE. Activation PROOF is the live
 * concurrency measurement (observed max concurrency 1→N + burst-span drop),
 * never a static assert — see docs/handoffs/pr2-v2-quick-parallelize-cp498.md.
 */
export function richSummaryWorkOptions(concurrency: number): {
  teamConcurrency: number;
  teamSize: number;
  teamRefill: true;
} {
  return { teamConcurrency: concurrency, teamSize: concurrency, teamRefill: true };
}
