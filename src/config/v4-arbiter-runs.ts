/**
 * v4 LLM-arbiter PoC runs configuration (CP489+).
 *
 * Centralizes env reads for the operator-only dashboard at
 * `/admin/v4-arbiter-runs` so the hardcode-audit rule is satisfied.
 * The runs dir holds JSON files matching handoff §11.4 schema;
 * operator places files there out-of-band.
 */

const DEFAULT_RUNS_DIR = '/var/insighta/v4-runs';

export function getV4ArbiterRunsDir(): string {
  return process.env['V4_ARBITER_RUNS_DIR']?.trim() || DEFAULT_RUNS_DIR;
}
