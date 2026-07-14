/**
 * Serving-path embed fast-timeout gate (P0 2026-07-10 incident).
 *
 * prod routes card-serving embeds to OpenRouter (IKS_EMBED_PROVIDER=openrouter,
 * #616 Mac Mini deprecation). OpenRouter's qwen3-embedding-8b latency degraded
 * to a catastrophic tail: prod video_discover_traces embed.batch p50 1455ms
 * (07-03) -> 8442ms (07-10), p90 2923ms -> 36073ms (36s), errs ~0 (slow, not
 * failing). A 30-42s embed on the wizard precompute / post-creation discover
 * path overruns the serving window, so the mandala shows 0 cards until a manual
 * refresh (~2 min later) — a precompute HIT -> MISS regression.
 *
 * The default embed budget is 20s x 2 retries (EMBED_TIMEOUT_MS /
 * OPENROUTER_EMBED_MAX_RETRIES) — bulk-safe, no window. This gate lets the
 * SERVING discover callers pass a tighter budget so a slow chunk fails fast to
 * the lexical path (per-chunk null -> those candidates drop to lexical ranking,
 * never 0 cards) instead of hanging the window. Bulk collector / backfill
 * embeds keep the 20s default: they have no window to protect, and cutting
 * them would only spike failure rate.
 *
 * Timeout default 12000ms is grounded on the measured trace distribution —
 * ABOVE batch p50 (~8.4s, must NOT cut the median or ~50% of mandalas downgrade
 * to lexical) and BELOW p90 (~30-42s, the tail we DO cut). 6s would gut the
 * median. Retries default 0 so a slow/404 chunk is a hard 12s cap, not
 * 12s x 3. Tune both via env once the downgrade counter
 * (getEmbedServingDowngradeCount) gives post-deploy data.
 *
 * Tuning knobs, not secrets (CP392): code default + env override, unset flag =
 * the existing 20s x 2 behavior (no-op -> flag alone rolls back).
 */
import type { EmbeddingClientOptions } from '@/skills/plugins/iks-scorer/embedding';

const DEFAULT_SERVING_TIMEOUT_MS = 12_000;
const DEFAULT_SERVING_MAX_RETRIES = 0;

export function isEmbedServingFastTimeoutEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['EMBED_SERVING_FAST_TIMEOUT_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** Per-call timeout (ms) for serving embeds when the gate is on. Default 12000. */
export function getEmbedServingTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['EMBED_SERVING_TIMEOUT_MS']);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SERVING_TIMEOUT_MS;
}

/** OpenRouter retry budget for serving embeds when the gate is on. Default 0. */
export function getEmbedServingMaxRetries(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['EMBED_SERVING_MAX_RETRIES']);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_SERVING_MAX_RETRIES;
}

/**
 * EmbeddingClientOptions for a serving/precompute discover embed call.
 * Returns {} when the gate is off -> embedBatch uses the 20s x 2 default.
 * When on, the returned opts cap the per-call budget and mark the call
 * `servingScope` so a downgrade (some inputs null) is counted for alarms.
 */
export function servingEmbedOptions(env: NodeJS.ProcessEnv = process.env): EmbeddingClientOptions {
  if (!isEmbedServingFastTimeoutEnabled(env)) return {};
  return {
    timeoutMs: getEmbedServingTimeoutMs(env),
    maxRetries: getEmbedServingMaxRetries(env),
    servingScope: true,
  };
}
