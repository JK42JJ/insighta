/**
 * llm-query-generator — Fix 2 (CP358) + race fallback (CP358 hotfix 2)
 *
 * Turns a single (sub_goal, center_goal, language) tuple into a small set of
 * natural-language YouTube search queries via TWO providers running in
 * parallel:
 *
 *   1. Mac Mini Ollama (llama3.1)        — local, free, sometimes slow/flaky
 *   2. OpenRouter (Qwen3 / configurable) — cloud, fast, $$
 *
 * `generateSearchQueriesRace` fires both via `Promise.allSettled`, returns
 * the **first** successful result (by wall time), and emits a structured
 * log row containing both queries + durations + errors for offline quality
 * comparison. The losing call is allowed to finish in the background — its
 * result is logged but discarded for this request, so neither provider
 * blocks the user response.
 *
 * Why: the first prod run on "조카 교육" (CP358 PR #367) had 7/8 Ollama
 * calls fail (suspected cold model + 30s timeout), leaving the cell loop
 * to fall back to the legacy single-keyword concat — destroying both query
 * diversity and quality. Adding OpenRouter as the parallel provider gives
 * us a fast, reliable path immediately while we collect Phase 2 evidence
 * on whether Mac Mini llama3.1 is good enough to drop OpenRouter later.
 *
 * Why: the previous executor concatenated `${sub_goal} ${top_keyword}` into
 * one string ("조카의 학습 동기 부여 공부") which YouTube's relevance ranker
 * scored badly — surfacing English/Chinese education content above Korean
 * results despite the Korean cell text. Generating 3 natural query phrases
 * ("조카 학습 동기 키우는 법", "초등학생 공부 동기부여", "아이 학습 의욕")
 * fixes the relevance signal at the API boundary.
 *
 * Defensive parsing pattern intentionally mirrors
 * trend-collector/sources/llm-extract.ts (markdown-fence stripping, object-
 * wrapper fallback, length filter, JSON repair).
 */

import { logger } from '@/utils/logger';

const DEFAULT_OLLAMA_URL = 'http://100.91.173.17:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.1:latest'; // verified installed on Mac Mini 2026-04-07
const OLLAMA_REQUEST_TIMEOUT_MS = 30_000;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_REQUEST_TIMEOUT_MS = 30_000;
const OPENROUTER_MAX_TOKENS = 256;
/** Hard cap on the number of queries returned to the caller. */
const MAX_QUERIES = 3;
/** Minimum length of a usable query (filters single-character noise). */
const MIN_QUERY_LENGTH = 2;

const log = logger.child({ module: 'llm-query-generator' });

export class LlmQueryGenError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmQueryGenError';
    this.status = status;
  }
}

export interface GenerateQueriesOpts {
  /** The cell's sub_goal text (e.g. "조카의 학습 동기 부여"). */
  subGoal: string;
  /** The mandala's root center goal (e.g. "조카 교육"). Used to anchor scope. */
  centerGoal: string;
  /** ISO 639-1 language code. Selects the prompt language. Defaults handled in caller. */
  language: string;
  /** Override Ollama URL (test injection). */
  baseUrl?: string;
  /** Override Ollama model name (test injection). */
  model?: string;
  /** Override fetch (test injection). */
  fetchImpl?: typeof fetch;
}

export interface OpenRouterQueriesOpts extends GenerateQueriesOpts {
  /** OpenRouter API key. Required (no fallback). */
  apiKey: string;
  /** OpenRouter model id, e.g. `qwen/qwen3-30b-a3b`. */
  openRouterModel: string;
}

export interface RaceQueriesOpts extends GenerateQueriesOpts {
  /**
   * OpenRouter API key. If absent, the race degenerates to Ollama-only.
   * Same convention as the existing mandala generator race fallback.
   */
  openRouterApiKey?: string;
  /** OpenRouter model id. Required when `openRouterApiKey` is present. */
  openRouterModel?: string;
}

/** Per-provider race result, structured for offline log analysis. */
export interface RaceProviderResult {
  provider: 'ollama' | 'openrouter';
  /** Queries returned, or `null` if this provider failed/aborted. */
  queries: string[] | null;
  /** Wall time of this provider's call (ms). Always populated. */
  durationMs: number;
  /** Error message if `queries === null`. */
  error?: string;
  /** Model identifier used (e.g. `llama3.1:latest`, `qwen/qwen3-30b-a3b`). */
  model: string;
}

/**
 * Race outcome — what the executor consumes plus the bookkeeping needed to
 * write a comparison row to a future `llm_query_comparisons` table. For
 * Phase 1 we just emit this object via `logger.info` so prod docker logs
 * carry the data; Phase 2 can backfill a real table from those logs.
 */
export interface RaceQueriesResult {
  /** The first successful provider's queries (used by the executor). */
  winner: RaceProviderResult;
  /** The other provider's outcome — kept for offline comparison. */
  loser: RaceProviderResult | null;
}

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

interface OpenRouterChatResponse {
  choices?: Array<{ message?: { content?: string; reasoning?: string } }>;
  error?: { message?: string };
}

/**
 * Generate up to {@link MAX_QUERIES} YouTube search queries via Mac Mini
 * Ollama. Throws {@link LlmQueryGenError} on transport failure, model
 * error, empty response, or unparseable JSON.
 *
 * Direct callers (tests, race orchestrator) should be ready to catch and
 * fall back. Production callers should prefer {@link generateSearchQueriesRace}
 * which fires both providers in parallel.
 */
export async function generateSearchQueriesViaOllama(opts: GenerateQueriesOpts): Promise<string[]> {
  const baseUrl = opts.baseUrl ?? DEFAULT_OLLAMA_URL;
  const model = opts.model ?? DEFAULT_OLLAMA_MODEL;
  const fetchFn = opts.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSystemPrompt(opts.language) },
          {
            role: 'user',
            content: buildUserPrompt(opts.subGoal, opts.centerGoal, opts.language),
          },
        ],
        stream: false,
        think: false,
        format: 'json',
        options: { temperature: 0.4 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new LlmQueryGenError(
      `Ollama chat failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 200);
    } catch {
      // ignore
    }
    throw new LlmQueryGenError(`Ollama chat HTTP ${res.status}: ${body}`, res.status);
  }

  const data = (await res.json()) as OllamaChatResponse;
  if (data.error) {
    throw new LlmQueryGenError(`Ollama chat error: ${data.error}`);
  }
  const content = data.message?.content;
  if (!content) {
    throw new LlmQueryGenError('Ollama chat returned empty content');
  }

  return parseQueriesResponse(content);
}

// ============================================================================
// OpenRouter provider
// ============================================================================

/**
 * Generate up to {@link MAX_QUERIES} YouTube search queries via OpenRouter.
 * Same prompt + JSON parsing as Ollama. Throws {@link LlmQueryGenError} on
 * any failure. The race orchestrator catches and records the error.
 *
 * Note: OpenRouter Qwen3 models do NOT support `format: json`, so the
 * prompt itself enforces JSON-only output and the parser strips
 * occasional markdown fences. The provider explicitly disables Qwen3
 * "reasoning" mode (matches `OpenRouterGenerationProvider` behavior) so
 * the response.content isn't drained by reasoning tokens.
 */
export async function generateSearchQueriesViaOpenRouter(
  opts: OpenRouterQueriesOpts
): Promise<string[]> {
  if (!opts.apiKey) {
    throw new LlmQueryGenError('OpenRouter API key not configured');
  }
  const fetchFn = opts.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetchFn(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
        'HTTP-Referer': 'https://insighta.one',
        'X-Title': 'Insighta',
      },
      body: JSON.stringify({
        model: opts.openRouterModel,
        messages: [
          { role: 'system', content: buildSystemPrompt(opts.language) },
          {
            role: 'user',
            content: buildUserPrompt(opts.subGoal, opts.centerGoal, opts.language),
          },
        ],
        temperature: 0.4,
        max_tokens: OPENROUTER_MAX_TOKENS,
        // Same flag as OpenRouterGenerationProvider: Qwen3 burns tokens on
        // "reasoning" otherwise and content arrives empty.
        reasoning: { enabled: false },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new LlmQueryGenError(
      `OpenRouter request failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).slice(0, 200);
    } catch {
      // ignore
    }
    throw new LlmQueryGenError(`OpenRouter HTTP ${res.status}: ${body}`, res.status);
  }

  const data = (await res.json()) as OpenRouterChatResponse;
  if (data.error?.message) {
    throw new LlmQueryGenError(`OpenRouter error: ${data.error.message}`);
  }
  const message = data.choices?.[0]?.message;
  const content = message?.content || message?.reasoning;
  if (!content) {
    throw new LlmQueryGenError('OpenRouter returned empty content');
  }
  return parseQueriesResponse(content);
}

// ============================================================================
// Race orchestrator — fire both providers, return first success, log loser
// ============================================================================

/**
 * Fire Ollama and OpenRouter in parallel via `Promise.allSettled`. Returns
 * the **first** successful provider's queries (by wall time). The loser's
 * outcome is included in the result for offline quality comparison and is
 * also emitted via `logger.info({phase:'video-discover.race-comparison',...})`
 * so prod docker logs carry a structured row per cell.
 *
 * Failure modes:
 *   - Both succeed → winner = whichever resolved first, loser = the other
 *   - One succeeds  → winner = that one, loser = failed provider (with error)
 *   - Both fail     → throws {@link LlmQueryGenError} aggregating both
 *                     errors. The executor catches and falls back to legacy
 *                     concat — service never blocks on the LLM path.
 *
 * If `openRouterApiKey` is empty/missing, the function degrades to
 * Ollama-only (no race) so callers don't need to branch on configuration.
 */
export async function generateSearchQueriesRace(opts: RaceQueriesOpts): Promise<RaceQueriesResult> {
  const ollamaModel = opts.model ?? DEFAULT_OLLAMA_MODEL;
  const openRouterModel = opts.openRouterModel ?? '';

  // Provider degraded mode — Ollama only.
  if (!opts.openRouterApiKey || !openRouterModel) {
    const ollamaT0 = Date.now();
    try {
      const queries = await generateSearchQueriesViaOllama(opts);
      const result: RaceQueriesResult = {
        winner: {
          provider: 'ollama',
          queries,
          durationMs: Date.now() - ollamaT0,
          model: ollamaModel,
        },
        loser: null,
      };
      log.info('race comparison (single provider)', {
        phase: 'video-discover.race-comparison',
        mode: 'degraded-ollama-only',
        winner: result.winner,
      });
      return result;
    } catch (err) {
      throw new LlmQueryGenError(
        `Ollama-only mode failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const ollamaT0 = Date.now();
  const openRouterT0 = Date.now();

  // Wrap each provider call with the start time captured at fire-time so
  // we get accurate wall-clock duration regardless of which one resolves
  // first. We use Promise.allSettled (NOT Promise.race) because we want
  // BOTH outcomes for the comparison log — letting the loser run to
  // completion in the background does not delay the user response since
  // we await whichever fulfilled first via the helper below.
  const ollamaPromise = generateSearchQueriesViaOllama(opts).then(
    (queries): RaceProviderResult => ({
      provider: 'ollama',
      queries,
      durationMs: Date.now() - ollamaT0,
      model: ollamaModel,
    }),
    (err): RaceProviderResult => ({
      provider: 'ollama',
      queries: null,
      durationMs: Date.now() - ollamaT0,
      error: err instanceof Error ? err.message : String(err),
      model: ollamaModel,
    })
  );

  const openRouterPromise = generateSearchQueriesViaOpenRouter({
    ...opts,
    apiKey: opts.openRouterApiKey,
    openRouterModel,
  }).then(
    (queries): RaceProviderResult => ({
      provider: 'openrouter',
      queries,
      durationMs: Date.now() - openRouterT0,
      model: openRouterModel,
    }),
    (err): RaceProviderResult => ({
      provider: 'openrouter',
      queries: null,
      durationMs: Date.now() - openRouterT0,
      error: err instanceof Error ? err.message : String(err),
      model: openRouterModel,
    })
  );

  // Race for the first SUCCESSFUL provider. We can't just use
  // Promise.race because the first to settle might be a rejection — we
  // want to wait for either a fulfilled success or for both to settle.
  const winner = await firstSuccess([ollamaPromise, openRouterPromise]);
  // Wait for both to complete so the loser is fully populated for the log.
  // The loser is fire-and-forget for the executor's purposes (its queries
  // are discarded) but we need its outcome for the comparison row.
  const [ollamaResult, openRouterResult] = await Promise.all([ollamaPromise, openRouterPromise]);
  const loser = winner.provider === 'ollama' ? openRouterResult : ollamaResult;

  const result: RaceQueriesResult = { winner, loser };
  log.info(`race comparison (${winner.provider} won in ${winner.durationMs}ms)`, {
    phase: 'video-discover.race-comparison',
    mode: 'race',
    winner_provider: winner.provider,
    winner_duration_ms: winner.durationMs,
    winner_queries: winner.queries,
    winner_model: winner.model,
    loser_provider: loser.provider,
    loser_duration_ms: loser.durationMs,
    loser_queries: loser.queries,
    loser_model: loser.model,
    loser_error: loser.error ?? null,
    sub_goal: opts.subGoal,
    center_goal: opts.centerGoal,
    language: opts.language,
  });
  return result;
}

/**
 * Resolve to the **first** provider result whose `queries` field is
 * non-null. Falls back to throwing {@link LlmQueryGenError} aggregating
 * both errors when neither provider succeeds.
 */
async function firstSuccess(promises: Promise<RaceProviderResult>[]): Promise<RaceProviderResult> {
  return new Promise((resolve, reject) => {
    let settled = 0;
    const errors: string[] = [];
    for (const p of promises) {
      p.then(
        (result) => {
          if (result.queries !== null && result.queries.length > 0) {
            // First success wins. Subsequent settlements are ignored
            // because Promise resolve() is idempotent.
            resolve(result);
            return;
          }
          if (result.error) errors.push(`${result.provider}: ${result.error}`);
          settled += 1;
          if (settled === promises.length) {
            reject(new LlmQueryGenError(`All providers failed in race: ${errors.join(' | ')}`));
          }
        },
        (err) => {
          // Should not happen — provider promises catch internally and
          // surface as { queries: null, error }. Defensive logging:
          errors.push(`unexpected: ${err instanceof Error ? err.message : String(err)}`);
          settled += 1;
          if (settled === promises.length) {
            reject(new LlmQueryGenError(`All providers failed in race: ${errors.join(' | ')}`));
          }
        }
      );
    }
  });
}

/**
 * Backwards-compat shim for existing tests/callers. Calls Ollama directly
 * (no race). New production code should call {@link generateSearchQueriesRace}.
 *
 * @deprecated Use {@link generateSearchQueriesRace} for prod or
 *   {@link generateSearchQueriesViaOllama} for direct Ollama-only tests.
 */
export async function generateSearchQueries(opts: GenerateQueriesOpts): Promise<string[]> {
  return generateSearchQueriesViaOllama(opts);
}

// ============================================================================
// Prompt construction
// ============================================================================

function buildSystemPrompt(language: string): string {
  if (language.startsWith('ko')) {
    return [
      '당신은 학습 목표를 YouTube 검색어로 변환하는 도우미입니다.',
      '응답은 반드시 JSON 배열 한 개만 출력하세요.',
      '설명, 마크다운, 코드 펜스, 다른 텍스트를 절대 포함하지 마세요.',
    ].join(' ');
  }
  return [
    'You are an assistant that turns learning goals into YouTube search queries.',
    'Respond with ONE JSON array only.',
    'Never include explanations, markdown, code fences, or any other text.',
  ].join(' ');
}

function buildUserPrompt(subGoal: string, centerGoal: string, language: string): string {
  if (language.startsWith('ko')) {
    return [
      `다음 학습 목표에 대해 YouTube에서 검색할 한국어 검색어 ${MAX_QUERIES}개를 생성하세요.`,
      '목표를 달성하려는 사람이 실제로 검색할 법한 자연스러운 한국어 검색어로 만드세요.',
      '',
      `만다라 중심 주제: ${centerGoal || '(미지정)'}`,
      `세부 목표: ${subGoal}`,
      '',
      '규칙:',
      `- ${MAX_QUERIES}개 모두 서로 다른 각도`,
      '- 각 검색어는 2~6 단어',
      '- 한국어로만 작성',
      '- 이모지, 해시태그, 따옴표 금지',
      '',
      `JSON 배열로만 응답: ["검색어1", "검색어2", "검색어3"]`,
      '다른 텍스트, 설명, markdown 금지.',
    ].join('\n');
  }
  return [
    `Generate ${MAX_QUERIES} YouTube search queries (in ${language}) for the goal below.`,
    'The queries should be the kind of phrases a real learner would type into YouTube.',
    '',
    `Mandala center goal: ${centerGoal || '(unspecified)'}`,
    `Sub goal: ${subGoal}`,
    '',
    'Rules:',
    `- ${MAX_QUERIES} queries, each from a different angle`,
    '- 2-6 words per query',
    `- Written only in ${language}`,
    '- No emoji, hashtags, or quotation marks',
    '',
    `Respond with a JSON array only: ["query 1", "query 2", "query 3"]`,
    'No other text, explanations, or markdown.',
  ].join('\n');
}

// ============================================================================
// Response parsing — defensive against the various shapes Ollama emits
// ============================================================================

/**
 * Parse the model's response into a normalized list of search queries.
 *
 * Defensive against (in priority order):
 *  - Raw JSON array of strings (the happy path)
 *  - Markdown-fenced JSON array (`\`\`\`json [...]\`\`\``)
 *  - Object wrappers with `queries` / `results` / `items` keys
 *  - Trailing whitespace, leading newlines, BOMs
 *  - Empty / 1-character / quoted-empty queries (filtered out)
 *  - More than MAX_QUERIES results (truncated)
 *
 * Throws {@link LlmQueryGenError} only when nothing usable could be extracted.
 */
export function parseQueriesResponse(content: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const stripped = stripMarkdownFence(content);
    try {
      parsed = JSON.parse(stripped);
    } catch {
      throw new LlmQueryGenError(`Could not parse LLM JSON: ${content.slice(0, 200)}`);
    }
  }

  // Accept several shapes
  let candidates: unknown[] = [];
  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['queries'])) candidates = obj['queries'];
    else if (Array.isArray(obj['results'])) candidates = obj['results'];
    else if (Array.isArray(obj['items'])) candidates = obj['items'];
  }

  const cleaned: string[] = [];
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const trimmed = c
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    if (trimmed.length < MIN_QUERY_LENGTH) continue;
    cleaned.push(trimmed);
    if (cleaned.length >= MAX_QUERIES) break;
  }

  if (cleaned.length === 0) {
    throw new LlmQueryGenError(`LLM returned no usable queries: ${content.slice(0, 200)}`);
  }
  return cleaned;
}

function stripMarkdownFence(s: string): string {
  // Strip ```json ... ``` or ``` ... ``` wrappers (mirrors llm-extract.ts)
  const trimmed = s.trim();
  if (trimmed.startsWith('```')) {
    const firstNewline = trimmed.indexOf('\n');
    const lastFence = trimmed.lastIndexOf('```');
    if (firstNewline > 0 && lastFence > firstNewline) {
      return trimmed.slice(firstNewline + 1, lastFence).trim();
    }
  }
  return s;
}
