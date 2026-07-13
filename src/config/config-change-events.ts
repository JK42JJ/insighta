/**
 * Config-change ledger — pure helpers (perf-monitor PR1, design 2026-07-13).
 *
 * Flag gate + the non-secret flag fingerprint + diff. Kept import-free so the
 * boot reporter, the metrics rollup, and unit tests share one definition
 * without dragging the prisma/logger chain.
 *
 * Flag: CONFIG_CHANGE_EVENTS_ENABLED (unset = no-op — no reads, no writes).
 */

export function isConfigChangeEventsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['CONFIG_CHANGE_EVENTS_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * Non-secret discover/quality flag fingerprint. Prefix whitelist keeps the
 * set self-extending (a new V5_* knob is captured without touching this
 * file); the deny-substring guard is defense-in-depth against a secret ever
 * matching a whitelisted prefix.
 */
const FLAG_PREFIXES = [
  'V3_',
  'V5_',
  'V2_',
  'DISCOVER_',
  'WIZARD_',
  'INFLOW_GATE',
  'JUDGE_',
  'PRECOMPUTE_',
  'PIPELINE_',
  'EMBED_SERVING_',
  'OPENROUTER_EMBED_',
  'MANDALA_EMBED_',
  'IKS_EMBED_',
  'AUTO_ADD_',
  'POOL_SERVE_',
  'SUPPLY_',
  'RICH_SUMMARY',
  'BOOK_',
  'LIVE_SEARCH_',
  'SEARCH_TRACE_',
  'RELEVANCE_',
  'VISUAL_CV_',
  'CONFIG_CHANGE_EVENTS_',
] as const;

const DENY_SUBSTRINGS = ['KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'PASS', 'URL', 'DSN', 'CREDENTIAL'];

export function buildFlagsFingerprint(
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v == null) continue;
    if (!FLAG_PREFIXES.some((p) => k.startsWith(p))) continue;
    if (DENY_SUBSTRINGS.some((d) => k.includes(d))) continue;
    out[k] = v;
  }
  return out;
}

export interface FlagDiffEntry {
  from: string | null;
  to: string | null;
}

/** Changed keys only: {key: {from, to}}. null = key absent on that side. */
export function diffFlags(
  prev: Record<string, string>,
  next: Record<string, string>
): Record<string, FlagDiffEntry> {
  const diff: Record<string, FlagDiffEntry> = {};
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const from = k in prev ? prev[k]! : null;
    const to = k in next ? next[k]! : null;
    if (from !== to) diff[k] = { from, to };
  }
  return diff;
}

/** Build SHA baked into the image (Dockerfile ARG). null when absent (local dev). */
export function getGitSha(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env['GIT_SHA'] ?? '').trim();
  return v.length > 0 ? v : null;
}
