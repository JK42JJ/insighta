/**
 * OpenRouter LLM Provider
 *
 * Cloud-based generation via OpenRouter API (OpenAI-compatible format).
 * Generation only — embedding uses Gemini/Ollama providers.
 * Issue: #251 (MA-2: GraphDB Service Layer)
 */

import type { GenerationProvider, GenerateOptions } from './provider';
import { config } from '../../config';
import { logLLMCall } from './call-logger';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 120_000;

// CP498 — retry transient 429 / 5xx with backoff. OpenRouter rate limits are
// dynamic (credit-based); a parallel Heart / relevance-backfill burst can
// briefly 429. Network/timeout errors are deliberately NOT retried: a stalled
// request may have completed server-side, so retrying risks a double
// generation (and double charge).
const OPENROUTER_MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 429 and 5xx are safe to retry (no generation completed). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Honour Retry-After (delta-seconds or HTTP-date) when present; else exponential backoff. */
export function retryDelayMs(retryAfter: string | null, attempt: number): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(RETRY_CAP_MS, secs * 1_000);
    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) return Math.min(RETRY_CAP_MS, Math.max(0, dateMs - Date.now()));
  }
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
}

export class OpenRouterGenerationProvider implements GenerationProvider {
  readonly name = 'openrouter';
  private readonly modelOverride?: string;

  constructor(modelOverride?: string) {
    this.modelOverride = modelOverride;
  }

  get model(): string {
    return `openrouter/${this.modelOverride ?? config.openrouter.model}`;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const startTime = Date.now();
    const apiKey = config.openrouter.apiKey;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    const activeModel = this.modelOverride ?? config.openrouter.model;

    // W2 (CP499+) — prompt-level thinking suppression for Qwen models.
    // The `reasoning: {enabled:false}` param below is IGNORED by some
    // OpenRouter providers (prod 2026-06-10: reasoning-only 1024-cap
    // responses + 20-48s latencies DESPITE the param). `/no_think` is the
    // Qwen chat-template soft switch — applied at the template layer, so it
    // holds regardless of which provider serves the call. Idempotent: skipped
    // when the caller (e.g. chatbot qwen-prompt-middleware) already added it.
    const effectivePrompt =
      config.openrouter.qwenNoThink && activeModel.includes('qwen') && !prompt.includes('/no_think')
        ? `${prompt}\n/no_think`
        : prompt;

    const body: Record<string, unknown> = {
      model: activeModel,
      messages: [{ role: 'user', content: effectivePrompt }],
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    };

    // JSON mode: instruct the model to return valid JSON only.
    // OpenRouter requires explicit response_format to enforce JSON output —
    // unlike Ollama (body['format']='json') and Gemini (responseMimeType),
    // OpenRouter silently drops format hints unless this field is present.
    if (options?.format === 'json') {
      body['response_format'] = { type: 'json_object' };
    }

    // Disable thinking/reasoning mode for Qwen models only — Qwen3 consumes
    // token budget on reasoning, leaving content empty.
    // See troubleshooting.md "Qwen3 thinking 모드 → 빈 응답".
    // Claude/Anthropic models do not support this field and will error if sent.
    if (activeModel.includes('qwen')) {
      body['reasoning'] = { enabled: false };
    }

    // Forward external abort (e.g. race-fallback discarding the LLM loser)
    // into the per-attempt controller so the underlying fetch is cancelled too.
    const externalSignal = options?.signal;

    // CP498 — retry loop for transient 429 / 5xx. A fresh AbortController +
    // timeout is created per attempt (abort is terminal). The loop always
    // assigns `response` or throws before breaking.
    let response!: Response;
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const onExternalAbort = () => controller.abort();
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
      }

      try {
        response = await fetch(OPENROUTER_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://insighta.one',
            'X-Title': 'Insighta',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        const latencyMs = Date.now() - startTime;
        if ((err as Error).name === 'AbortError') {
          // Distinguish "external cancel" from internal timeout for clearer logs.
          if (externalSignal?.aborted) {
            logLLMCall({
              videoId: options?.videoId,
              userId: options?.userId,
              module: 'openrouter',
              model: this.model,
              latencyMs,
              status: 'error',
              errorMessage: 'Request cancelled by external signal',
            }).catch(() => {});
            throw new Error('OpenRouter request cancelled by external signal');
          }
          logLLMCall({
            videoId: options?.videoId,
            userId: options?.userId,
            module: 'openrouter',
            model: this.model,
            latencyMs,
            status: 'error',
            errorMessage: `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
          }).catch(() => {});
          throw new Error(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
        }
        logLLMCall({
          videoId: options?.videoId,
          userId: options?.userId,
          module: 'openrouter',
          model: this.model,
          latencyMs,
          status: 'error',
          errorMessage: err instanceof Error ? err.message : String(err),
        }).catch(() => {});
        throw err;
      } finally {
        clearTimeout(timeout);
        if (externalSignal) {
          externalSignal.removeEventListener('abort', onExternalAbort);
        }
      }

      // Transient 429 / 5xx → backoff and retry (no generation completed).
      if (!response.ok && isRetryableStatus(response.status) && attempt < OPENROUTER_MAX_RETRIES) {
        const delayMs = retryDelayMs(response.headers?.get?.('retry-after') ?? null, attempt);
        logLLMCall({
          videoId: options?.videoId,
          userId: options?.userId,
          module: 'openrouter',
          model: this.model,
          latencyMs: Date.now() - startTime,
          status: 'error',
          errorMessage: `Retryable ${response.status}; backoff ${delayMs}ms (attempt ${attempt + 1}/${OPENROUTER_MAX_RETRIES})`,
        }).catch(() => {});
        await sleep(delayMs);
        continue;
      }
      break;
    }

    if (!response.ok) {
      const errorBody = await response.text();
      logLLMCall({
        videoId: options?.videoId,
        userId: options?.userId,
        module: 'openrouter',
        model: this.model,
        latencyMs: Date.now() - startTime,
        status: 'error',
        errorMessage: `API error ${response.status}: ${errorBody.slice(0, 200)}`,
      }).catch(() => {});
      throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content: string; reasoning?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    // Log token usage for performance analysis (existing behaviour preserved)
    if (data.usage) {
      console.info(
        `[OpenRouter] model=${activeModel} prompt=${data.usage.prompt_tokens} completion=${data.usage.completion_tokens} total=${data.usage.total_tokens}`
      );
    }

    const message = data.choices?.[0]?.message;
    const content = message?.content;
    if (!content) {
      const hasReasoning = !!message?.reasoning;
      logLLMCall({
        videoId: options?.videoId,
        userId: options?.userId,
        module: 'openrouter',
        model: this.model,
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        latencyMs: Date.now() - startTime,
        status: 'error',
        errorMessage: hasReasoning
          ? 'Empty content: reasoning-only response (CoT leakage blocked)'
          : 'Empty content returned',
      }).catch(() => {});
      throw new Error(
        `OpenRouter returned empty content${hasReasoning ? ' (reasoning-only response detected — CoT leakage blocked)' : ''}`
      );
    }

    // Fire-and-forget cost log — errors handled inside logLLMCall
    logLLMCall({
      videoId: options?.videoId,
      userId: options?.userId,
      module: 'openrouter',
      model: this.model,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      latencyMs: Date.now() - startTime,
      status: 'success',
    }).catch(() => {});

    return content;
  }
}
