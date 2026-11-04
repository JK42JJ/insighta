/**
 * What a chat-completions response says about how it ended.
 *
 * An empty body used to be logged with token counts and an error string only,
 * so "the reasoning used the whole budget" was inferred from output_tokens
 * being exactly the cap, never read. These fields answer it directly: why the
 * generation stopped, how much of it was reasoning, and which provider and
 * model version actually served the call.
 *
 * Kept free of config imports so it can be tested on its own.
 */

export interface OpenRouterChatResponse {
  /** The model that served the call; can differ from the one requested. */
  model?: string;
  /** The upstream provider OpenRouter routed the call to. */
  provider?: string;
  choices?: Array<{
    message?: { content?: string | null; reasoning?: string | null };
    finish_reason?: string | null;
    native_finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /**
     * Present when the provider served part of the prompt from cache.
     * OpenRouter has returned this the whole time and nothing read it, so
     * "is caching working" had no answer and neither did "would it".
     */
    prompt_tokens_details?: { cached_tokens?: number };
    /** Reasoning tokens are counted inside completion_tokens. */
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

export interface ResponseMeta {
  responseModel?: string;
  provider?: string;
  finishReason?: string;
  nativeFinishReason?: string;
  completionTokens?: number;
  reasoningTokens?: number;
  /** Lengths only: the text itself is never stored. */
  reasoningChars: number;
  contentChars: number;
}

export function extractResponseMeta(data: OpenRouterChatResponse): ResponseMeta {
  const choice = data.choices?.[0];
  return {
    responseModel: data.model,
    provider: data.provider,
    finishReason: choice?.finish_reason ?? undefined,
    nativeFinishReason: choice?.native_finish_reason ?? undefined,
    completionTokens: data.usage?.completion_tokens,
    reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
    reasoningChars: choice?.message?.reasoning?.length ?? 0,
    contentChars: choice?.message?.content?.length ?? 0,
  };
}
