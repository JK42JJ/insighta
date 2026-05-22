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
import { getChatbotContext } from '@/api/routes/chatbot-context-storage';
import {
  buildQwenSystemPrompt,
  type ChatLayer,
  type Lang,
  type MandalaContext as PromptMandalaContext,
} from './prompt-builder';
import { loadVideoContext, type VideoGroundingResult } from './video-context-loader';
import { loadUserContext } from './user-context-loader';
import { loadMandalaContext } from './mandala-context-loader';
import { loadMandalaCards } from './mandala-cards-loader';
import { loadMandalaBook } from './mandala-book-loader';
import { loadNoteContext } from './note-loader';
import { retrieveRAGContext } from './retriever';
import type {
  UserContext,
  MandalaCardsContext,
  MandalaBookContext,
  NoteDraftContext,
  RAGContext,
} from './types';

const log = logger.child({ module: 'chatbot-rag/qwen-prompt-middleware' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Matches the FE's video URL pattern; group 1 = 11-char video id. */
const VIDEO_ID_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

/**
 * CP477+15 — Pulls FE-emitted chatContext JSON fields out of the
 * original system prompt.
 *
 * Why regex instead of JSON.parse: CopilotKit's `useCopilotReadable`
 * embeds the readable value somewhere inside its own role-instructions
 * template — the boundary is not stable across CopilotKit versions, so
 * tolerant regex per field is more robust than trying to JSON.parse
 * the entire system prompt.
 *
 * Source: `frontend/src/pages/learning/ui/ChatAssistant.tsx:358-366`.
 */
const MANDALA_ID_REGEX = /"mandala_id"\s*:\s*"([0-9a-fA-F-]{36})"/;
const CELL_INDEX_REGEX = /"cell_index"\s*:\s*(-?\d+)/;

function parseCurrentMandalaId(systemContent: string): string | undefined {
  const match = MANDALA_ID_REGEX.exec(systemContent);
  return match?.[1];
}

function parseCurrentCellIndex(systemContent: string): number | null {
  const match = CELL_INDEX_REGEX.exec(systemContent);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pulls the latest user message text out of a V3Message[] prompt — used
 * as the RAG retriever's query. Returns undefined when the prompt has
 * no user turn (e.g., the initial system-only setup).
 */
function extractLastUserMessageText(prompt: LanguageModelV3Message[]): string | undefined {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i];
    if (!msg || msg.role !== 'user') continue;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      for (let j = msg.content.length - 1; j >= 0; j--) {
        const part = msg.content[j];
        if (part?.type === 'text' && typeof part.text === 'string') return part.text;
      }
    }
  }
  return undefined;
}

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
        // CP477+5 — Append `/no_think` at the END OF THE LAST USER MESSAGE
        // (Qwen3 chat template standard location for reasoning gating).
        // System-prompt placement caused echo + multi-turn break (CP475+5
        // → CP477+4 regression). `@ai-sdk/openai@3.0.53` has no extraBody
        // escape hatch so we cannot forward `chat_template_kwargs` here —
        // user-message-end is the only Vercel-SDK-compatible path.
        const withDirective = appendNoThinkToLastUserMessage(rewritten ?? params.prompt);
        // CP475+4 — vLLM Pod started without --enable-auto-tool-choice +
        // --tool-call-parser, so any inbound `tool_choice: 'auto'` (the
        // Vercel AI SDK default when the route configures tools) produces:
        //   400 "auto" tool choice requires --enable-auto-tool-choice ...
        // The Insighta chatbot doesn't use tool calling, so we force tools
        // off in the request that hits vLLM.
        const next = {
          ...params,
          prompt: withDirective,
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

  // CP477+15 — pass the last user message text into the system rewriter
  // as the RAG retrieval query. retrieveRAGContext returns 0 results
  // when the query is empty or whitespace-only, so cold-start setup
  // turns with no user text don't trigger an embedding call.
  const lastUserMessage = extractLastUserMessageText(prompt);

  const newSystemContent = await rewriteSystemContent(systemContents.join('\n\n'), {
    lastUserMessage,
  });

  const newSystemMsg: LanguageModelV3Message = {
    role: 'system',
    content: newSystemContent,
  };

  return [newSystemMsg, ...otherMessages];
}

/**
 * Append the Qwen3 `/no_think` directive to a system prompt to suppress the
 * model's reasoning block. Required because the chat_template_kwargs path
 * (`enable_thinking: false`) is only honoured on the legacy `process()`
 * code path — the Vercel AI SDK V3 chat model in `getLanguageModel()` does
 * not forward provider-specific kwargs, so without this textual directive
 * the model leaks its full English reasoning chain into the response.
 *
 * CP475+5 — bug-report 2026-05-20: chatbot responses started with
 * "Okay, let me try to figure out how to handle this..." (entire reasoning
 * chain in English) before the actual Korean answer.
 */
export function appendNoThinkDirective(systemContent: string): string {
  if (systemContent.includes('/no_think')) return systemContent;
  return `${systemContent}\n\n/no_think`;
}

/**
 * Append `/no_think` to the END of the LAST USER MESSAGE in the prompt.
 *
 * CP477+5 — Qwen3 chat template recognises `/no_think` only when it
 * appears at the end of the user turn's content (verified empirically:
 * image 16 showed the directive emitted as a raw token when placed in
 * system; images 17/18 showed multi-turn break caused by the echo). The
 * vLLM-specific `chat_template_kwargs.enable_thinking=false` is forwarded
 * on the legacy `process()` body but NOT by `@ai-sdk/openai@3.0.53` (no
 * `extraBody` escape hatch in V3 — verified by reading
 * `node_modules/@ai-sdk/openai/dist/index.js`), so the user-message-end
 * placement is the only path that gates reasoning on both Vercel SDK and
 * vLLM backends — and it works for OpenRouter Qwen3.5-9B too (same
 * Qwen-family chat template).
 *
 * Idempotent — leaves the message unchanged if it already ends with
 * `/no_think`.
 */
export function appendNoThinkToLastUserMessage(
  prompt: LanguageModelV3Message[]
): LanguageModelV3Message[] {
  if (prompt.length === 0) return prompt;
  let lastUserIdx = -1;
  for (let i = prompt.length - 1; i >= 0; i--) {
    if (prompt[i]!.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return prompt;

  const userMsg = prompt[lastUserIdx]!;
  if (userMsg.role !== 'user') return prompt;
  const parts = userMsg.content;
  if (!Array.isArray(parts) || parts.length === 0) return prompt;

  let lastTextIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]!.type === 'text') {
      lastTextIdx = i;
      break;
    }
  }
  if (lastTextIdx === -1) return prompt;

  const textPart = parts[lastTextIdx]!;
  if (textPart.type !== 'text') return prompt;
  const trimmed = textPart.text.trimEnd();
  if (trimmed.endsWith('/no_think')) return prompt;

  const newParts = [...parts];
  newParts[lastTextIdx] = { ...textPart, text: `${trimmed} /no_think` };
  const newPrompt = [...prompt];
  newPrompt[lastUserIdx] = { ...userMsg, content: newParts };
  return newPrompt;
}

/**
 * Plain-string variant for the legacy `process()` path — message content
 * there is already a flat `{role, content: string}` shape. Same
 * idempotency + last-user semantics as the V3 variant.
 */
export function appendNoThinkToLastUserMessageString(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  if (messages.length === 0) return messages;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return messages;
  const msg = messages[lastUserIdx]!;
  const trimmed = msg.content.trimEnd();
  if (trimmed.endsWith('/no_think')) return messages;
  const newMessages = messages.slice();
  newMessages[lastUserIdx] = { ...msg, content: `${trimmed} /no_think` };
  return newMessages;
}

/**
 * Force the chatbot's timestamp output into a single canonical format so the
 * FE `linkifyTimestamps` can convert ALL timestamps into clickable buttons.
 *
 * CP477+2 — bug-report 2026-05-20: the model sometimes emits `(0:56-1:12)`
 * (M:SS form, FE regex matches → clickable) and sometimes `380~682초:`
 * (raw seconds, FE regex does NOT match → plain text). Users see
 * inconsistent timestamp affordance across responses on the same video.
 *
 * The Insighta SFT-aligned `ROLE_AND_RULES_KO/EN` already gives one example
 * (`(1:00-1:12)`) but doesn't forbid raw-seconds variants. Adding a
 * stand-alone directive at runtime keeps the SFT byte-identical while
 * tightening the output contract on every request.
 *
 * Idempotent — directive marker is detected by a unique substring.
 */
const TIMESTAMP_RULE_KO = `[타임스탬프 형식]
- 타임스탬프는 반드시 "M:SS" 또는 "(M:SS-M:SS)" 형식.
- "N초" (예: 380초) 또는 "N~M초" (예: 380~682초) 형식 금지.
- 초 단위 값 언급 필요 시: 380초 → "(6:20)" 으로 변환해 출력.`;

const TIMESTAMP_RULE_EN = `[Timestamp format]
- All timestamps MUST be in "M:SS" or "(M:SS-M:SS)" form.
- Forbidden: raw-seconds form ("380s") or seconds range ("380~682s").
- Convert seconds to M:SS before emitting (e.g., 380s → "(6:20)").`;

const TIMESTAMP_RULE_MARKER = '[타임스탬프 형식]';
const TIMESTAMP_RULE_MARKER_EN = '[Timestamp format]';

export function appendTimestampFormatRule(systemContent: string, language: Lang): string {
  if (
    systemContent.includes(TIMESTAMP_RULE_MARKER) ||
    systemContent.includes(TIMESTAMP_RULE_MARKER_EN)
  ) {
    return systemContent;
  }
  const rule = language === 'en' ? TIMESTAMP_RULE_EN : TIMESTAMP_RULE_KO;
  return `${systemContent}\n\n${rule}`;
}

/**
 * Plain-string variant for the legacy SSE streaming path (QwenRunpodAdapter.process).
 *
 * Same pipeline as rewriteSystemPrompt but consumes/returns a single
 * concatenated system-content string — process() builds `{role, content:
 * string}` directly from CopilotKit TextMessages, so the V3Message shape
 * conversion isn't needed.
 */
export async function rewriteSystemContent(
  originalSystemContent: string,
  opts?: { lastUserMessage?: string }
): Promise<string> {
  const language = detectLanguage(originalSystemContent);

  // Parse FE-emitted chatContext fields out of the system prompt.
  const videoMatch = VIDEO_ID_REGEX.exec(originalSystemContent);
  const youtubeVideoId = videoMatch?.[1] ?? null;
  const currentMandalaId = parseCurrentMandalaId(originalSystemContent);
  const currentCellIndex = parseCurrentCellIndex(originalSystemContent);

  const chatbotCtx = getChatbotContext();
  const authenticated = Boolean(chatbotCtx?.userId);

  // Step 1 — user-context (Block U). Needed even outside a mandala
  // (chatbot must answer "내 만다라 몇개?").
  let userContext: UserContext | null = null;
  if (chatbotCtx?.userId) {
    try {
      userContext = await loadUserContext({
        userId: chatbotCtx.userId,
        email: chatbotCtx.email ?? '',
        displayName: chatbotCtx.displayName,
        currentMandalaId,
        preferredLanguage: language,
      });
    } catch (err) {
      log.warn('loadUserContext failed; skipping Block U', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Step 2 — fetch all mandala-scoped contexts + video grounding +
  // optional RAG in parallel. Each loader is fail-safe and returns
  // null on error; prompt-builder treats null as "block omitted".
  const mandalaName = userContext?.current_mandala_name ?? '';
  const lastUserMessage = opts?.lastUserMessage;

  const [videoCtx, mandalaCtxResult, mandalaCards, mandalaBook, noteDraft, ragContext] =
    await Promise.all([
      youtubeVideoId
        ? loadCachedVideoContext(youtubeVideoId, language)
        : Promise.resolve<VideoGroundingResult>({ v2Data: null, transcript: null }),
      currentMandalaId && mandalaName
        ? loadMandalaContext({
            mandalaId: currentMandalaId,
            mandalaName,
            cellIndex: currentCellIndex,
          })
        : Promise.resolve(null),
      authenticated && currentMandalaId && chatbotCtx?.userId
        ? loadMandalaCards({
            userId: chatbotCtx.userId,
            mandalaId: currentMandalaId,
          }).catch((err: unknown) => {
            log.warn('loadMandalaCards failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            return null;
          })
        : Promise.resolve<MandalaCardsContext | null>(null),
      currentMandalaId
        ? loadMandalaBook({ mandalaId: currentMandalaId }).catch((err: unknown) => {
            log.warn('loadMandalaBook failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            return null;
          })
        : Promise.resolve<MandalaBookContext | null>(null),
      authenticated && currentMandalaId && chatbotCtx?.userId
        ? loadNoteContext({
            userId: chatbotCtx.userId,
            mandalaId: currentMandalaId,
          }).catch((err: unknown) => {
            log.warn('loadNoteContext failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            return null;
          })
        : Promise.resolve<NoteDraftContext | null>(null),
      authenticated && lastUserMessage && lastUserMessage.trim().length > 0 && chatbotCtx?.userId
        ? retrieveRAGContext({
            userId: chatbotCtx.userId,
            query: lastUserMessage,
            mandalaId: currentMandalaId,
          }).catch((err: unknown) => {
            log.warn('retrieveRAGContext failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            return null;
          })
        : Promise.resolve<RAGContext | null>(null),
    ]);

  const mandalaContext: PromptMandalaContext | null = mandalaCtxResult?.context ?? null;

  // Layer selection follows the data we actually loaded: video page →
  // 'video' (or 'cell' when a cell is selected), mandala-only → 'mandala',
  // unauth or pre-mandala → 'global'.
  const layer: ChatLayer = youtubeVideoId
    ? currentCellIndex && currentCellIndex >= 1
      ? 'cell'
      : 'video'
    : currentMandalaId
      ? 'mandala'
      : 'global';

  const built = buildQwenSystemPrompt({
    layer,
    language,
    v2Data: videoCtx.v2Data,
    transcript: videoCtx.transcript,
    userContext,
    mandalaContext,
    mandalaCards,
    mandalaBook,
    noteDraft,
    ragContext,
    includePersona: true,
  });
  // CP477+2 — tighten timestamp output to a single canonical form so the
  // FE linkifier can convert every timestamp to a clickable seek button
  // (chatbot output was mixing `(M:SS-M:SS)` with `N초` / `N~M초`).
  const withTimestampRule = appendTimestampFormatRule(built, language);
  // CP477+4 — system-prompt `/no_think` REMOVED.
  //   - User-reported 2026-05-21: openrouter Qwen3.5-9B emitted `/no_think`
  //     as a raw token (echo) at the start of every response, and the echo
  //     in history corrupted the next turn (multi-turn break).
  //   - Root cause: Qwen3 chat template only recognises `/no_think` at the
  //     END OF THE USER MESSAGE, not in the system prompt. The vLLM path
  //     gates reasoning via `chat_template_kwargs.enable_thinking=false`
  //     (process()-only), so the system-prompt directive was always the
  //     wrong tool — it just happened to be silently ignored by the LoRA
  //     in CP475+5 testing and only surfaced as echo on the OpenRouter
  //     base model.
  //   - Trade-off: Vercel AI SDK V3 (`getLanguageModel()` path) still
  //     strips `chat_template_kwargs`, so reasoning chain MAY leak on the
  //     qwen-runpod path. Acceptable until a proper user-message-end
  //     directive lands. The legacy process() path is unaffected (body
  //     still carries `chat_template_kwargs.enable_thinking=false`).
  return withTimestampRule;
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
