/**
 * OpenRouter embed provider routing prefs (P0 2026-07-11, beta D-1).
 *
 * OpenRouter routes qwen3-embedding-8b across Nebius / DeepInfra /
 * SiliconFlow. Pinned-provider probes from the prod container (2026-07-11):
 *   DeepInfra    25s+ hang 3/3 (100%)   <- the wizard 27-96s serving killer
 *   SiliconFlow  0.57-0.86s
 *   Nebius       0.54-6.9s
 * Default routing hit the hung provider ~1/3 of calls (probe: 3-4 of 10 at
 * 29.6-30s+), and EMBED_TIMEOUT_MS(20s) x retries turned each hit into a 40s
 * stall on the wizard critical path. Uptime stats (99.97%+) do NOT show this
 * — uptime is not latency.
 *
 * OPENROUTER_EMBED_IGNORE_PROVIDERS: comma-separated provider names to skip
 * (request-level `provider: { ignore: [...] }`). Unset/empty = no provider
 * field at all — exact current behavior (flag alone rolls back). Ignore is
 * chosen over order-pinning so the remaining healthy providers still load-
 * balance and a future bad apple can be added without re-ranking the rest.
 *
 * Tuning knob, not a secret (CP392). Full incident record:
 * docs/qa/wizard-0card-investigation-2026-07-11.md
 */
export function getEmbedIgnoreProviders(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = String(env['OPENROUTER_EMBED_IGNORE_PROVIDERS'] ?? '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
