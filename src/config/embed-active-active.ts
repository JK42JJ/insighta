/**
 * Embedding active-active gate (P0 follow-up 2026-07-10).
 *
 * `embedBatch` embeds against a single provider (Mac Mini Ollama by default,
 * OpenRouter on sequential fallback). The Mac Mini is a home host reached over
 * Tailscale — a SPOF that took down card serving (0-card incident) when its
 * GPU could not load the model ("Compute error"). Both providers emit the
 * SAME 4096-d qwen3-embedding-8b space, so either can serve any request.
 *
 * When EMBED_ACTIVE_ACTIVE_ENABLED, embedOneChunk uses a **hedge**: Ollama
 * primary, and OpenRouter is fired in parallel ONLY when Ollama (a) rejects
 * fast (e.g. the 500 "Compute error" — immediate) or (b) exceeds
 * EMBED_HEDGE_MS. A healthy Ollama (measured p50 ~1.9s) never pays the
 * OpenRouter call, so this removes the SPOF without the always-2× cost of a
 * blind Promise.any. First success wins; the loser is AbortController-
 * cancelled. Both dead → throw (downstream lexical path).
 *
 * EMBED_HEDGE_MS default 18000 — above the measured p95 (~17.1s, n=32 sparse)
 * so the hedge fires only on clearly-sick latency, not normal tail. Lower it
 * via env once the hedge-trigger counter gives denser data (lowering is the
 * safe direction; starting low risks a silent 2× cost leak).
 *
 * Tuning knobs, not secrets (CP392): code default + env override, unset = the
 * existing sequential-fallback behavior (no-op → flag alone rolls back).
 */
export function isEmbedActiveActiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env['EMBED_ACTIVE_ACTIVE_ENABLED'] ?? '')
    .trim()
    .toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/** Hedge delay (ms) before firing the OpenRouter leg on a slow (not rejected) Ollama call. */
export function getEmbedHedgeMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['EMBED_HEDGE_MS']);
  return Number.isFinite(raw) && raw > 0 ? raw : 18000;
}
