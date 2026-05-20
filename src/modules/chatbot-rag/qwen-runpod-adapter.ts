/**
 * src/modules/chatbot-rag/qwen-runpod-adapter.ts
 *
 * Custom CopilotServiceAdapter for the RunPod-hosted Qwen chatbot.
 *
 * 🎯 Bug 1 (multi-turn fail on prod) — root cause + fix
 *
 * Root cause (verified 2026-05-20, CP474 review):
 *   - `OpenAIAdapter.getLanguageModel()` calls `createOpenAI({...})(model)`,
 *     which `@ai-sdk/openai/openai-provider.ts:239-241` resolves to
 *     `createResponsesModel` → OpenAI **Responses API** endpoint `/v1/responses`.
 *   - vLLM (and OpenRouter for older Gemini models) does NOT implement
 *     `/v1/responses`. On the second turn, when the assistant history
 *     gets serialized to Responses-API format (`apply_patch_call_output`
 *     etc.), schema validation fails → `Invalid Responses API request`.
 *
 * Fix:
 *   - This adapter calls `createOpenAI({...}).chat(model)` instead, which
 *     `openai-provider.ts:245` routes to `createChatModel` → **Chat
 *     Completions endpoint** `/v1/chat/completions`. vLLM v0.9.0 supports
 *     this 1-1, and multi-turn smoke (manual curl) confirmed end-to-end.
 *
 * Secondary roles (not yet wired in this MVP):
 *   - Inject Insighta persona / user context / RAG block / Block T
 *     transcript fallback into the system message. Currently the FE's
 *     `buildInstructions` produces the system message; rewriting happens
 *     in Stage 4 (separate commit) via a middleware that wraps the
 *     returned LanguageModel.
 *
 * Design ref: docs/design/insighta-chatbot-prompt-serving-design.md §6(d).
 */

import OpenAI from 'openai';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { randomUUID } from '@copilotkit/shared';
import type {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from '@copilotkit/runtime';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'insighta-chatbot';

/**
 * vLLM Qwen3 chat template knob — disables `<think>` reasoning blocks so
 * answers come back as direct content rather than wrapped reasoning. The
 * matching FE behaviour exists in `ChatAssistant.tsx` (`/no_think`).
 */
const CHAT_TEMPLATE_KWARGS = { enable_thinking: false } as const;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface QwenRunpodAdapterParams {
  /** Full base URL of the vLLM endpoint, e.g. `https://<pod>.proxy.runpod.net/openai/v1`. */
  baseURL: string;
  /** Bearer token configured on vLLM via `--api-key`. */
  apiKey: string;
  /** Served model name (vLLM's `--served-model-name`). Default 'insighta-chatbot'. */
  model?: string;
}

/**
 * Adapter that routes Insighta chatbot traffic to the RunPod-hosted vLLM
 * Qwen LoRA model via OpenAI **chat.completions** (not Responses API).
 *
 * Implements both:
 *   - `getLanguageModel()` — preferred path; used by CopilotRuntime
 *     BuiltInAgent integration. Returns a Vercel AI SDK LanguageModel
 *     pinned to chat.completions.
 *   - `process()` — legacy/streaming fallback for runtime configurations
 *     that don't take the BuiltInAgent path.
 */
export class QwenRunpodAdapter implements CopilotServiceAdapter {
  public readonly provider = 'qwen-runpod';
  public readonly model: string;
  public readonly name = 'QwenRunpodAdapter';
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly openaiSDK: OpenAI;

  constructor(params: QwenRunpodAdapterParams) {
    if (!params.baseURL) {
      throw new Error('QwenRunpodAdapter: baseURL is required');
    }
    if (!params.apiKey) {
      throw new Error('QwenRunpodAdapter: apiKey is required');
    }
    this.baseURL = params.baseURL;
    this.apiKey = params.apiKey;
    this.model = params.model ?? DEFAULT_MODEL;
    this.openaiSDK = new OpenAI({ baseURL: this.baseURL, apiKey: this.apiKey });
  }

  /**
   * Returns a Vercel AI SDK LanguageModel that targets the **chat.completions**
   * endpoint (not Responses API). This is the Bug 1 fix — see file header.
   *
   * 비교:
   *   - `createOpenAI({...})(modelId)` → Responses API (❌ Bug 1 source)
   *   - `createOpenAI({...}).chat(modelId)` → chat.completions (✅ vLLM compat)
   */
  getLanguageModel(): LanguageModel {
    const aiProvider = createOpenAI({
      baseURL: this.baseURL,
      apiKey: this.apiKey,
    });
    return aiProvider.chat(this.model);
  }

  /**
   * Legacy streaming path used by older CopilotRuntime call sites.
   *
   * Scope (MVP):
   *   - Text messages only (Insighta chatbot has no tool/action use case)
   *   - Streams plain text deltas through eventSource (start → content → end)
   *
   * Future (Stage 4):
   *   - System message rewrite (persona + user_ctx + RAG + Block T)
   *   - Tool call passthrough if Insighta later introduces useCopilotAction
   */
  async process(
    request: CopilotRuntimeChatCompletionRequest
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const { messages, eventSource, threadId, forwardedParameters } = request;

    const openaiMessages = messages.filter(textMessageGuard).map((m) => {
      const t = m as unknown as TextMessageLike;
      return { role: normalizeRole(t.role), content: t.content };
    });

    // vLLM-specific: chat_template_kwargs (enable_thinking=false) is forwarded
    // as an extra body key. OpenAI SDK's chat.completions request type doesn't
    // include it, so we type the body as a structural shape.
    interface QwenChatRequestBody {
      model: string;
      stream: true;
      messages: ReadonlyArray<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      chat_template_kwargs: { enable_thinking: boolean };
      max_completion_tokens?: number;
      temperature?: number;
      stop?: string | string[];
    }
    const body: QwenChatRequestBody = {
      model: this.model,
      stream: true,
      messages: openaiMessages,
      chat_template_kwargs: CHAT_TEMPLATE_KWARGS,
    };
    if (forwardedParameters?.maxTokens) body.max_completion_tokens = forwardedParameters.maxTokens;
    if (forwardedParameters?.temperature !== undefined)
      body.temperature = forwardedParameters.temperature;
    if (forwardedParameters?.stop) body.stop = forwardedParameters.stop;

    // `stream: true` returns Stream<ChatCompletionChunk> which is AsyncIterable.
    // The cast is needed because TS picks the non-stream overload when the
    // body type doesn't statically expose `stream: true` to the SDK's overload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = (await this.openaiSDK.chat.completions.create(
      body as any
    )) as unknown as AsyncIterable<{
      id?: string;
      choices: Array<{ delta?: { content?: string } }>;
    }>;

    // Fire-and-forget — eventSource.stream() drives the SSE write loop; the
    // adapter returns the threadId immediately while streaming continues in
    // the background. `void` marks the intentional unawaited promise.
    void eventSource.stream(async (eventStream$) => {
      let mode: 'message' | null = null;
      let currentMessageId = '';

      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            if (mode === null) {
              mode = 'message';
              currentMessageId = chunk.id ?? randomUUID();
              eventStream$.sendTextMessageStart({ messageId: currentMessageId });
            }
            eventStream$.sendTextMessageContent({
              messageId: currentMessageId,
              content: delta,
            });
          }
        }

        if (mode === 'message') {
          eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
        }
      } catch (err) {
        // Stream-time errors surface to the client via eventStream$.complete()
        // closure — CopilotKit FE will render a fallback.
        if (mode === 'message' && currentMessageId) {
          eventStream$.sendTextMessageEnd({ messageId: currentMessageId });
        }
        throw err;
      }

      eventStream$.complete();
    });

    return { threadId: threadId ?? randomUUID() };
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

type TextMessageLike = { isTextMessage: () => boolean; role: string; content: string };

function textMessageGuard(m: unknown): m is TextMessageLike {
  if (!m || typeof m !== 'object') return false;
  const guard = m as { isTextMessage?: () => boolean };
  return typeof guard.isTextMessage === 'function' && guard.isTextMessage();
}

function normalizeRole(role: string): 'system' | 'user' | 'assistant' {
  if (role === 'system' || role === 'developer') return 'system';
  if (role === 'assistant') return 'assistant';
  return 'user';
}
