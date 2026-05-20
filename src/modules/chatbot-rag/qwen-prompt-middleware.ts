/**
 * src/modules/chatbot-rag/qwen-prompt-middleware.ts
 *
 * Vercel AI SDK middleware (LanguageModelV3) that rewrites the system
 * prompt for qwen-runpod requests so the LoRA model receives its
 * SFT-aligned format (Persona + Block A-D or Block T) instead of the
 * legacy FE-built English prompt.
 *
 * Path (per call):
 *   1. Extract concatenated system-message content from `params.prompt`.
 *   2. Parse YouTube video_id from the URL embedded by the FE builder.
 *   3. Detect language (`ko` default, `en` when FE prompt opens "You are").
 *   4. Load video context (v2 row OR transcript fallback) — cached 5min.
 *   5. Call `buildQwenSystemPrompt({ ..., includePersona: true })`.
 *   6. Replace all system messages with a single new one carrying the
 *      SFT-aligned prompt.
 *
 * Out of scope (deferred to Stage 7b+):
 *   - userId-aware Block U / Block H. The middleware runs at the
 *     LanguageModel layer and doesn't have direct access to the HTTP
 *     request's JWT. Threading user identity through CopilotRuntime
 *     context is a separate plumbing change.
 *
 * Fail-safe: any error in the middleware returns the original params
 * unchanged so requests still succeed (just without persona injection).
 */

import type { LanguageModelV3Middleware, LanguageModelV3Message } from '@ai-sdk/provider';
import { logger } from '@/utils/logger';
import { buildQwenSystemPrompt, type ChatLayer, type Lang } from './prompt-builder';
import { loadVideoContext, type VideoGroundingResult } from './video-context-loader';

const log = logger.child({ module: 'chatbot-rag/qwen-prompt-middleware' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Matches the FE's video URL pattern; group 1 = 11-char video id. */
const VIDEO_ID_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

/** Per-videoId cache TTL for context loads. 5 minutes balances freshness vs latency. */
const VIDEO_CONTEXT_CACHE_MS = 5 * 60 * 1000;

interface CacheEntry {
  context: VideoGroundingResult;
  expiresAt: number;
}

const videoContextCache = new Map<string, CacheEntry>();

// Test hook — clears the singleton cache between unit tests.
export function _resetMiddlewareCacheForTesting(): void {
  videoContextCache.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a fresh middleware instance. Each call returns a new object so
 * the underlying cache (module-level) can be shared across instances but
 * the middleware object itself stays disposable.
 */
export function createQwenPromptMiddleware(): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3' as const,
    transformParams: async ({ params }) => {
      try {
        const rewritten = await rewriteSystemPrompt(params.prompt);
        // CP475+4 — vLLM Pod started without --enable-auto-tool-choice +
        // --tool-call-parser, so any inbound `tool_choice: 'auto'` (the
        // Vercel AI SDK default when the route configures tools) produces:
        //   400 "auto" tool choice requires --enable-auto-tool-choice ...
        // The Insighta chatbot doesn't use tool calling, so we force tools
        // off in the request that hits vLLM.
        const next = {
          ...params,
          prompt: rewritten ?? params.prompt,
          toolChoice: { type: 'none' as const },
          tools: [],
        };
        return next;
      } catch (err) {
        log.warn('middleware failed; forwarding original params', {
          error: err instanceof Error ? err.message : String(err),
        });
        return params;
      }
    },
  };
}

/**
 * Exposed for the AI SDK middleware path (getLanguageModel route).
 * Returns the rewritten LanguageModelV3 prompt or null when nothing
 * needed rewriting.
 */
export async function rewriteSystemPrompt(
  prompt: LanguageModelV3Message[]
): Promise<LanguageModelV3Message[] | null> {
  if (prompt.length === 0) return null;

  // Split system vs non-system messages, preserving order of the latter.
  const systemContents: string[] = [];
  const otherMessages: LanguageModelV3Message[] = [];

  for (const msg of prompt) {
    if (msg.role === 'system' && typeof msg.content === 'string') {
      systemContents.push(msg.content);
    } else {
      otherMessages.push(msg);
    }
  }

  const newSystemContent = await rewriteSystemContent(systemContents.join('\n\n'));

  const newSystemMsg: LanguageModelV3Message = {
    role: 'system',
    content: newSystemContent,
  };

  return [newSystemMsg, ...otherMessages];
}

/**
 * Plain-string variant for the legacy SSE streaming path (QwenRunpodAdapter.process).
 *
 * Same pipeline as rewriteSystemPrompt but consumes/returns a single
 * concatenated system-content string — process() builds `{role, content:
 * string}` directly from CopilotKit TextMessages, so the V3Message shape
 * conversion isn't needed.
 */
export async function rewriteSystemContent(originalSystemContent: string): Promise<string> {
  const language = detectLanguage(originalSystemContent);

  const videoMatch = VIDEO_ID_REGEX.exec(originalSystemContent);
  const youtubeVideoId = videoMatch?.[1] ?? null;

  let videoCtx: VideoGroundingResult = { v2Data: null, transcript: null };
  if (youtubeVideoId) {
    videoCtx = await loadCachedVideoContext(youtubeVideoId, language);
  }

  const layer: ChatLayer = youtubeVideoId ? 'video' : 'global';

  return buildQwenSystemPrompt({
    layer,
    language,
    v2Data: videoCtx.v2Data,
    transcript: videoCtx.transcript,
    includePersona: true,
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function loadCachedVideoContext(
  videoId: string,
  language: Lang
): Promise<VideoGroundingResult> {
  const cached = videoContextCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.context;
  }

  const fresh = await loadVideoContext({
    youtubeVideoId: videoId,
    preferredLanguage: language,
  });
  videoContextCache.set(videoId, {
    context: fresh,
    expiresAt: Date.now() + VIDEO_CONTEXT_CACHE_MS,
  });
  return fresh;
}

/**
 * Lightweight language sniff. FE buildInstructions begins with English
 * "You are Insighta's learning assistant." when language=en, otherwise
 * with Korean role intro. We don't ship i18n parsing into the middleware
 * — a single first-line probe is enough for the persona language toggle.
 */
function detectLanguage(systemContent: string): Lang {
  const firstLine = systemContent.slice(0, 200);
  if (/^You are Insighta/i.test(firstLine)) return 'en';
  if (/You are/i.test(firstLine) && !/한국어|만다라|챗봇|학습/.test(firstLine)) {
    return 'en';
  }
  return 'ko';
}
