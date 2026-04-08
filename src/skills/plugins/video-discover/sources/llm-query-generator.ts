/**
 * llm-query-generator — Fix 2 (CP358, video-discover quality experiment 01)
 *
 * Calls Mac Mini Ollama (llama3.1) to turn a single (sub_goal, center_goal,
 * language) tuple into a small set of natural-language YouTube search queries.
 *
 * Why: the previous executor concatenated `${sub_goal} ${top_keyword}` into
 * one string ("조카의 학습 동기 부여 공부") which YouTube's relevance ranker
 * scored badly — surfacing English/Chinese education content above Korean
 * results despite the Korean cell text. Generating 3 natural query phrases
 * ("조카 학습 동기 키우는 법", "초등학생 공부 동기부여", "아이 학습 의욕")
 * fixes the relevance signal at the API boundary.
 *
 * Pattern intentionally mirrors trend-collector/sources/llm-extract.ts for
 * consistency: same Ollama base URL, same defensive JSON parsing, same
 * markdown-fence stripping, same fetchImpl override hook for tests.
 */

const DEFAULT_OLLAMA_URL = 'http://100.91.173.17:11434';
const DEFAULT_MODEL = 'llama3.1:latest'; // verified installed on Mac Mini 2026-04-07
const REQUEST_TIMEOUT_MS = 30_000;
/** Hard cap on the number of queries returned to the caller. */
const MAX_QUERIES = 3;
/** Minimum length of a usable query (filters single-character noise). */
const MIN_QUERY_LENGTH = 2;

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
  /** Override model name (test injection). */
  model?: string;
  /** Override fetch (test injection). */
  fetchImpl?: typeof fetch;
}

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

/**
 * Generate up to {@link MAX_QUERIES} YouTube search queries for one
 * (subGoal, centerGoal, language) tuple. Throws {@link LlmQueryGenError}
 * on transport failure, model error, empty response, or unparseable JSON.
 *
 * Caller is expected to catch and fall back to the legacy keyword-concat
 * path so a single Ollama hiccup doesn't take down the whole skill.
 */
export async function generateSearchQueries(opts: GenerateQueriesOpts): Promise<string[]> {
  const baseUrl = opts.baseUrl ?? DEFAULT_OLLAMA_URL;
  const model = opts.model ?? DEFAULT_MODEL;
  const fetchFn = opts.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
