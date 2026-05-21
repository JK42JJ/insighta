/**
 * Health-check failover helpers for the chatbot route (CP477+3).
 *
 * Probes the configured RunPod vLLM Pod's `/health` endpoint and decides
 * which provider should actually serve the next request. When the Pod is
 * unreachable, `qwen-runpod` is silently downgraded to `openrouter` so
 * users never see a stalled chatbot.
 *
 * Pure-ish module — imports only `toRunpodOpenAiBase` (also pure) so it
 * can be unit-tested by mocking global `fetch` without dragging in
 * `src/config/index.ts`'s top-level zod env validation (which fails
 * under jest without a populated process.env).
 */

import { toRunpodOpenAiBase } from './copilotkit-base-url';
import type { ChatbotProvider } from './copilotkit-model-resolver';

const VLLM_HEALTH_CACHE_MS = 5_000;
// CP477+11 — shortened from 2000 to 500ms per CP477+6 handoff §4.1 spec.
// 2s probe timeout was an obvious user-facing tax on every cache-miss
// path (cold start + every 5min cache boundary). 500ms is still generous
// for a RunPod /health response (typical p95 < 100ms warm) while
// keeping the worst-case race window narrow enough that the
// req.pause()/req.resume() body buffer in copilotkit.ts can absorb it.
const VLLM_HEALTH_PROBE_TIMEOUT_MS = 500;

interface VllmHealthCache {
  healthy: boolean;
  checkedAt: number;
}

let vllmHealthCache: VllmHealthCache | null = null;

/** Test-only hook to flush the health cache between unit tests. */
export function _resetVllmHealthCacheForTesting(): void {
  vllmHealthCache = null;
}

/**
 * Derive the vLLM `/health` URL from the configured OpenAI base URL.
 *
 *   `https://<pod>.proxy.runpod.net/v1`
 *     → `https://<pod>.proxy.runpod.net/health`
 *   `https://api.runpod.ai/v2/<id>/openai/v1`
 *     → `https://api.runpod.ai/health`   (vLLM mounts /health at root)
 */
export function buildHealthUrl(openAiBase: string): string {
  const u = new URL(openAiBase);
  u.pathname = '/health';
  u.search = '';
  u.hash = '';
  return u.toString();
}

/**
 * Probe vLLM `/health`. 5-second TTL cache + 2-second per-probe timeout.
 *
 * Returns `false` (treats as unhealthy) on:
 *   - missing `apiUrl` (no Pod configured)
 *   - non-2xx response
 *   - network error / abort / timeout
 */
export async function isQwenRunpodHealthy(apiUrl: string | undefined): Promise<boolean> {
  const now = Date.now();
  if (vllmHealthCache && now - vllmHealthCache.checkedAt < VLLM_HEALTH_CACHE_MS) {
    return vllmHealthCache.healthy;
  }
  if (!apiUrl) {
    vllmHealthCache = { healthy: false, checkedAt: now };
    return false;
  }
  try {
    const healthUrl = buildHealthUrl(toRunpodOpenAiBase(apiUrl));
    const res = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(VLLM_HEALTH_PROBE_TIMEOUT_MS),
    });
    const healthy = res.ok;
    vllmHealthCache = { healthy, checkedAt: now };
    return healthy;
  } catch {
    vllmHealthCache = { healthy: false, checkedAt: now };
    return false;
  }
}

/**
 * Returns the provider that will actually serve this request, falling
 * back from `qwen-runpod` → `openrouter` when the RunPod Pod is
 * unreachable. Other configured providers are passed through unchanged.
 *
 * Side-effect free with respect to the cache — `isQwenRunpodHealthy`
 * owns the cache state.
 */
export async function resolveEffectiveProvider(
  configured: ChatbotProvider,
  apiUrl: string | undefined
): Promise<ChatbotProvider> {
  if (configured !== 'qwen-runpod') return configured;
  const healthy = await isQwenRunpodHealthy(apiUrl);
  return healthy ? 'qwen-runpod' : 'openrouter';
}
