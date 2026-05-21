/**
 * Background provider-health poller for chatbot failover (CP477+14).
 *
 * Replaces the PR #737 (CP477+11) per-request `resolveEffectiveProvider`
 * pattern, which placed a second async hop (`isQwenRunpodHealthy`) inside
 * the raw HTTP listener's `req.pause()` paused window. Prod BE log
 * confirmed that pattern fails: `Request stream consumed with no
 * available body; sending empty payload.` × 5+. Two async hops inside
 * the paused window race against the HTTP parser's 'data' event delivery.
 *
 * This module pulls the health probe OUT of the request path. A 5-second
 * `setInterval` updates the module-level `effectiveProvider`. The request
 * handler reads it synchronously via `getEffectiveProvider()` — no await,
 * no race. Provider transition latency is 0-5 s (next poller tick), which
 * is acceptable for Pod migration (typically 3-5 minutes).
 *
 * Disabled by default. The poller activates only when
 * `config.chatbot.failoverEnabled === true`. This keeps the merge-time
 * blast radius zero — code lives on main but takes effect only after an
 * explicit `gh variable set CHATBOT_FAILOVER_ENABLED=true` + redeploy.
 * Rollback path: flip the flag back to `false`; no code revert needed.
 *
 * See: docs/design/chatbot-failover-redesign-2026-05-22.md
 */

import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { isQwenRunpodHealthy } from './copilotkit-health';
import type { ChatbotProvider } from './copilotkit-model-resolver';

const POLLER_INTERVAL_MS = 5_000;

let pollerTimer: NodeJS.Timeout | null = null;
let effectiveProvider: ChatbotProvider | null = null;
let onProviderChangeCb: (next: ChatbotProvider) => void = () => undefined;

/**
 * Snapshot read of the current effective provider. Safe to call from
 * request handlers — no await, no I/O, no race.
 *
 * - If the failover flag is off, always returns the configured provider.
 * - If the poller has not run yet, returns the configured provider.
 * - Otherwise returns the value the poller last wrote.
 */
export function getEffectiveProvider(): ChatbotProvider {
  if (!config.chatbot.failoverEnabled) return config.chatbot.provider;
  return effectiveProvider ?? config.chatbot.provider;
}

/**
 * Start the background poller. Caller passes a callback fired when the
 * effective provider changes, used to invalidate the lazy yoga handler
 * so the next request rebuilds with the new adapter.
 *
 * No-op when the flag is off or the configured provider has no failover
 * target (only `qwen-runpod` flips to `openrouter`).
 */
export function startProviderHealthPoller(onChange: (next: ChatbotProvider) => void): void {
  if (!config.chatbot.failoverEnabled) {
    logger.info('chatbot failover poller disabled (flag OFF)');
    return;
  }
  if (config.chatbot.provider !== 'qwen-runpod') {
    logger.info('chatbot failover poller skipped (provider != qwen-runpod)', {
      provider: config.chatbot.provider,
    });
    return;
  }
  if (pollerTimer) {
    logger.warn('chatbot failover poller already running — skipping duplicate start');
    return;
  }

  onProviderChangeCb = onChange;
  effectiveProvider = config.chatbot.provider;

  const tick = async (): Promise<void> => {
    try {
      const healthy = await isQwenRunpodHealthy(config.qwenLora.apiUrl);
      const next: ChatbotProvider = healthy ? 'qwen-runpod' : 'openrouter';
      if (next !== effectiveProvider) {
        logger.info('chatbot failover transition', {
          from: effectiveProvider,
          to: next,
          reason: healthy ? 'pod recovered' : 'pod unreachable',
        });
        effectiveProvider = next;
        try {
          onProviderChangeCb(next);
        } catch (cbErr) {
          logger.error('chatbot failover onChange callback threw', {
            err: cbErr instanceof Error ? cbErr.message : String(cbErr),
          });
        }
      }
    } catch (err) {
      logger.warn('chatbot failover poller tick error (continuing)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  };

  void tick();
  pollerTimer = setInterval(() => void tick(), POLLER_INTERVAL_MS);
  pollerTimer.unref?.();
  logger.info('chatbot failover poller started', {
    intervalMs: POLLER_INTERVAL_MS,
    provider: config.chatbot.provider,
  });
}

/**
 * Stop the poller. Called by graceful shutdown handlers and by tests
 * between cases.
 */
export function stopProviderHealthPoller(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
  effectiveProvider = null;
  onProviderChangeCb = () => undefined;
}

/** Test-only — reset module state without touching the timer. */
export function _resetProviderPollerForTesting(): void {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
  effectiveProvider = null;
  onProviderChangeCb = () => undefined;
}
