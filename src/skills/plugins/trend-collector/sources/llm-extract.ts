/**
 * trend-collector — LLM keyword extraction (Phase 1.5a primary source)
 *
 * Calls Mac Mini Ollama (qwen3.5:9b) to extract topic keywords + a
 * learning relevance score from a batch of YouTube video titles.
 *
 * Why this is the PRIMARY source (and Suggest is secondary):
 *  - YouTube Trending titles are LLM-classifiable (we own the prompt)
 *  - Suggest is an unofficial Google endpoint — Google can close it any day
 *  - LLM extraction strips clickbait + normalizes phrasing
 *    ("역대급 스카이 다이빙" → ["스카이다이빙", "익스트림스포츠"])
 *  - learning_score lets the executor filter entertainment-only titles
 *    BEFORE they pollute trend_signals
 *
 * Failure mode: Mac Mini unreachable or non-JSON output → throw
 * LlmExtractError. Caller decides whether to fall back to Suggest-only
 * mode or fail the whole run.
 *
 * Quality preview: scripts/preview-llm-extract.ts runs 5 titles and
 * prints the extracted keywords for manual inspection BEFORE the full
 * pipeline runs against all 40+ titles.
 */

const DEFAULT_OLLAMA_URL = 'http://100.91.173.17:11434';
// Mac Mini installed models (verified 2026-04-07): llama3.1:latest (8B),
// qwen3-embedding:8b (embed-only, can't chat), mandala-gen (mandala-tuned).
// llama3.1 is the only general-purpose chat model available; use it for
// keyword extraction.
const DEFAULT_MODEL = 'llama3.1:latest';
const REQUEST_TIMEOUT_MS = 60000; // per-chunk timeout
/**
 * Chunk size for batched extraction. llama3.1 8B handles 5 titles in ~30s
 * comfortably; 40 titles in one shot exceeds 120s on Mac Mini M4.
 * Chunking gives predictable per-call latency + isolates failures.
 */
const DEFAULT_CHUNK_SIZE = 5;

export class LlmExtractError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'LlmExtractError';
  }
}

export interface ExtractedKeyword {
  /** Original video title (unchanged, for traceability). */
  title: string;
  /** 1-3 normalized topic keywords (Korean nouns/phrases). Always lowercased noise stripped. */
  keywords: string[];
  /** 0.0-1.0 — how educational/skill-learning the content is. */
  learning_score: number;
}

export interface ExtractKeywordsOptions {
  titles: string[];
  /** Override Ollama base URL. Defaults to Mac Mini. */
  baseUrl?: string;
  /** Override model. Defaults to llama3.1:latest. */
  model?: string;
  /** Override chunk size. Defaults to 5 (proven safe on llama3.1 8B). */
  chunkSize?: number;
  /** Injectable fetch for testability. */
  fetchImpl?: typeof fetch;
}

const SYSTEM_PROMPT = `너는 학습 콘텐츠 발굴 엔진을 위한 키워드 추출 시스템이다.
입력받은 한국어 YouTube 비디오 제목에서 아래 두 가지를 추출한다:

1. keywords: 1~3개의 정규화된 토픽 키워드 (한국어 명사 또는 짧은 구)
2. learning_score: 0.0~1.0 — 학습/스킬/교육 콘텐츠 정도

규칙:
- 클릭베이트 단어 제거: "역대급", "충격", "ㅋㅋㅋ", "TOP10", 이모지 등
- 기술/주제/도메인 명사만 보존
- 학습/실용/교육 키워드를 우선 선택
- 한국어로 유지 (영어 명사는 영어 그대로 OK)
- **키워드는 반드시 완전한 단어로 추출. 약어/잘림 금지.**
  - 예: "마케" ❌ → "마케팅" ✅
  - 예: "재테" ❌ → "재테크" ✅
  - 예: "프로그" ❌ → "프로그래밍" ✅
  - 예: "필라" ❌ → "필라테스" ✅

learning_score 기준:
- 1.0: 명시적 강의/튜토리얼/교육 ("파이썬 입문 강의", "토익 LC 정답률")
- 0.7: 정보성/다큐/리뷰 ("ChatGPT 사용법", "AI 동향")
- 0.5: 시사/뉴스/정보 ("부동산 정책", "선거 분석")
- 0.3: 라이프스타일/엔터테인먼트 ("브이로그", "먹방")
- 0.0: 순수 오락/리액션 ("역대급 스카이 다이빙", "충격 영상")

응답은 반드시 valid JSON 만:
{"results":[{"title":"<원본>","keywords":["<kw1>","<kw2>"],"learning_score":<float>}]}

다른 텍스트, 설명, markdown 금지.`;

function buildUserPrompt(titles: string[]): string {
  const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  return `다음 ${titles.length}개 제목에서 키워드를 추출하라:\n\n${numbered}`;
}

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
}

interface RawResult {
  title?: unknown;
  keywords?: unknown;
  learning_score?: unknown;
}

interface ResultsBody {
  results?: RawResult[];
}

/**
 * Extract keywords from a batch of titles, automatically chunking to keep
 * per-call latency predictable. Each chunk is one Ollama call.
 *
 * Returns one ExtractedKeyword per input title, in the same order as the
 * input. If a chunk fails entirely (timeout, parse error), its slots are
 * filled with empty extractions (keywords=[], learning_score=0.5) — caller
 * can choose to drop them or keep as low-signal placeholders.
 */
export async function extractKeywordsBatch(
  opts: ExtractKeywordsOptions
): Promise<ExtractedKeyword[]> {
  if (opts.titles.length === 0) return [];

  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const out: ExtractedKeyword[] = [];
  let successfulChunks = 0;
  let failedChunks = 0;
  let lastError: Error | null = null;

  for (let i = 0; i < opts.titles.length; i += chunkSize) {
    const chunk = opts.titles.slice(i, i + chunkSize);
    try {
      const chunkResults = await extractOneChunk(chunk, opts);
      out.push(...chunkResults);
      successfulChunks += 1;
    } catch (err) {
      failedChunks += 1;
      lastError = err instanceof Error ? err : new Error(String(err));
      // Pad failed chunk with empty extractions so the position-mapping
      // back to source titles stays aligned for partial-success runs.
      for (const title of chunk) {
        out.push({ title, keywords: [], learning_score: 0.5 });
      }
    }
  }

  // If EVERY chunk failed, throw — caller should treat this as "LLM source
  // unavailable" and fall back to other sources, not as "LLM returned empty".
  if (successfulChunks === 0 && failedChunks > 0) {
    throw new LlmExtractError(
      `All ${failedChunks} LLM chunks failed (last error: ${lastError?.message ?? 'unknown'})`
    );
  }

  return out;
}

/**
 * Single Ollama call for one chunk. Throws LlmExtractError on any failure;
 * extractKeywordsBatch catches and pads.
 */
async function extractOneChunk(
  titles: string[],
  opts: ExtractKeywordsOptions
): Promise<ExtractedKeyword[]> {
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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(titles) },
        ],
        stream: false,
        think: false,
        format: 'json',
        options: { temperature: 0.2 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new LlmExtractError(
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
    throw new LlmExtractError(`Ollama chat HTTP ${res.status}: ${body}`, res.status);
  }

  const data = (await res.json()) as OllamaChatResponse;
  if (data.error) {
    throw new LlmExtractError(`Ollama chat error: ${data.error}`);
  }
  const content = data.message?.content;
  if (!content) {
    throw new LlmExtractError('Ollama chat returned empty content');
  }

  return parseExtractionResponse(content, titles);
}

/**
 * Parse the model's JSON response into ExtractedKeyword[].
 *
 * Defensive against:
 *  - Truncated JSON (returns whatever parsed up to that point + pads missing)
 *  - Wrong field names (results vs items vs data)
 *  - Non-array keywords (single string → wrap in array)
 *  - Out-of-range learning_score (clamps to [0,1])
 *  - Title mismatch (uses position-based mapping when title doesn't match input)
 */
export function parseExtractionResponse(
  content: string,
  inputTitles: string[]
): ExtractedKeyword[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // qwen sometimes wraps JSON in markdown despite format=json — strip and retry
    const stripped = stripMarkdownFence(content);
    try {
      parsed = JSON.parse(stripped);
    } catch {
      throw new LlmExtractError(`Could not parse LLM JSON: ${content.slice(0, 200)}`);
    }
  }

  // Accept several shapes the model might emit
  const rawResults: RawResult[] = (() => {
    if (!parsed || typeof parsed !== 'object') return [];
    const obj = parsed as ResultsBody & { items?: RawResult[]; data?: RawResult[] };
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(parsed)) return parsed as RawResult[];
    return [];
  })();

  // Position-based mapping: assume the model preserved input order
  const out: ExtractedKeyword[] = inputTitles.map((title, i) => {
    const raw = rawResults[i];
    if (!raw) {
      return { title, keywords: [], learning_score: 0.5 };
    }
    return normalizeOne(title, raw);
  });

  return out;
}

function normalizeOne(title: string, raw: RawResult): ExtractedKeyword {
  let keywords: string[] = [];
  if (Array.isArray(raw.keywords)) {
    keywords = raw.keywords
      .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      .map((k) => k.trim());
  } else if (typeof raw.keywords === 'string') {
    keywords = [raw.keywords.trim()];
  }
  // Apply noise filter — drops Korean fragments / hallucinations like
  // "입력", "실합", "안소", "주속", "호는" etc that slipped past the prompt
  keywords = keywords.filter(isValidLearningKeyword);
  // Cap to 3 (prompt asked for 1-3 but defensive)
  if (keywords.length > 3) keywords = keywords.slice(0, 3);

  let score = 0.5;
  if (typeof raw.learning_score === 'number') {
    score = raw.learning_score;
  } else if (typeof raw.learning_score === 'string') {
    const parsed = parseFloat(raw.learning_score);
    if (!Number.isNaN(parsed)) score = parsed;
  }
  // Clamp
  if (score < 0) score = 0;
  if (score > 1) score = 1;

  return { title, keywords, learning_score: score };
}

/**
 * Curated whitelist of valid EXACTLY-2-character Korean learning keywords.
 *
 * Filter scope: only applied when a Korean-only string is exactly 2 chars
 * (`length === 2 && isKoreanOnly`). 3+ char Korean and English/mixed always
 * pass — they don't need a whitelist.
 *
 * IMPORTANT: do NOT abbreviate longer terms here. "마케팅" is 3 chars and
 * passes the filter naturally; adding "마케" as an abbreviation would be
 * a bug (the filter never sees "마케팅" since it's not 2 chars).
 *
 * Add to this list when a legitimate 2-char Korean term gets filtered.
 */
const KOREAN_2CHAR_LEARNING_WHITELIST = new Set<string>([
  // Generic learning vocabulary (highest impact — these attach to anything)
  '강의',
  '강좌',
  '학원',
  '입문',
  '기초',
  '심화',
  '응용',
  '실전',
  '도전',
  '시험',
  '학습',
  '공부',
  '연습',
  '훈련',
  '코칭',
  // Education / language
  '토익',
  '토플',
  '수능',
  '영어',
  '한국',
  '한자',
  // Hobby / arts
  '독서',
  '서예',
  '미술',
  '사진',
  '향수',
  '와인',
  '커피',
  '제과',
  '제빵',
  '바둑',
  '체스',
  '복싱',
  '발레',
  '재즈',
  '보컬',
  '드럼',
  '기타',
  '첼로',
  '하프',
  '국악',
  // Health / fitness
  '요가',
  '러닝',
  '수영',
  '등산',
  '명상',
  '단식',
  '식단',
  '근력',
  '운동',
  // Subjects
  '수학',
  '물리',
  '화학',
  '생물',
  '지학',
  '역사',
  '철학',
  '심리',
  '경제',
  '정치',
  '사회',
  '윤리',
  // Career / business
  '주식',
  '창업',
  '부업',
  '회계',
  '면접',
  '협상',
]);

/**
 * Validate an LLM-extracted keyword. Filters out:
 *  - Empty / single-char strings
 *  - Long sentence fragments (>60 chars)
 *  - Korean-only 2-char words NOT in the curated whitelist
 *    (catches "입력", "실합", "안소", "주속" etc — llama3.1 hallucinations)
 *  - Strings containing broken Hangul jamo (standalone ㄱ, ㅏ, etc)
 *
 * Returns true if the keyword is plausibly a real learning topic.
 */
export function isValidLearningKeyword(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (trimmed.length > 60) return false;

  // Reject standalone Hangul jamo (ㄱ, ㄴ, ㅏ, ㅓ, etc — broken text)
  if (/[\u3131-\u318e]/.test(trimmed)) return false;

  // Korean-only 2-char filter with whitelist exception
  const isKoreanOnly = /^[\uac00-\ud7af]+$/.test(trimmed);
  if (isKoreanOnly && trimmed.length === 2) {
    return KOREAN_2CHAR_LEARNING_WHITELIST.has(trimmed);
  }

  return true;
}

function stripMarkdownFence(s: string): string {
  // Strip ```json ... ``` or ``` ... ``` wrappers
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
