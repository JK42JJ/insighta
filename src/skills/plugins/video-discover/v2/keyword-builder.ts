/**
 * video-discover v2 — keyword builder
 *
 * Hybrid: ONE composite LLM call (existing C+ prompt via OpenRouter Haiku
 * race) + deterministic rule-based fallbacks. Total 3-5 queries per mandala.
 *
 * Why ONE call (not per-cell): v1 ran 8 cells × 1 call = 8 LLM calls per
 * mandala. v2 collapses to a single call by feeding the LLM a composite
 * "영역 핵심어" assembled from focus_tags + distinctive sub_goals. Output is
 * still 1-3 natural queries, but they cover the whole mandala scope.
 *
 * Why also rule-based: LLM can return 0-3 queries depending on response
 * quality. The 40-card hard target requires query-pool stability, so we
 * always seed with the centerGoal verbatim and pad with rule-based variants
 * if the LLM falls short. Final cap = 5 (matches the 500-unit quota target:
 * 5 × search.list × 100 units = 500).
 */

// C+ prompt + OpenRouter Haiku — same path as v1 executor. Previously this
// file used `generateSearchQueriesRace` (Ollama/OpenRouter race with a simple
// 2-6 word prompt) which produced low-quality queries and mixed unrelated
// domains in prod (bug: "가족여행" → ArgoCD/NCT results, 2026-04-15).
import { parseQueriesResponse } from '../sources/llm-query-generator';
import {
  buildSearchQueryPrompt,
  SEARCH_QUERY_MODEL,
  SEARCH_QUERY_TEMPERATURE,
  SEARCH_QUERY_MAX_TOKENS,
} from '@/prompts/search-query-generator';
import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'video-discover/v2/keyword-builder' });

export type KeywordLanguage = 'ko' | 'en';

export interface KeywordBuilderInput {
  centerGoal: string;
  subGoals: string[];
  focusTags?: string[];
  targetLevel?: string;
  language: KeywordLanguage;
}

export interface KeywordBuilderOpts {
  /** OpenRouter API key for the LLM race. Omit to skip LLM entirely. */
  openRouterApiKey?: string;
  /** OpenRouter model id (e.g. `qwen/qwen3-30b-a3b`). Required if apiKey set. */
  openRouterModel?: string;
  /** Override Ollama URL (legacy, unused after C+ switch — kept for callers). */
  baseUrl?: string;
  /** Override Ollama model (legacy, unused after C+ switch — kept for callers). */
  ollamaModel?: string;
  /** Inject fetch for tests (legacy; ignored by the C+ OpenRouter path). */
  fetchImpl?: typeof fetch;
  /**
   * Inject an LLM generator for tests so runLLMQueries can be exercised
   * without hitting OpenRouter. When absent, the real provider is used.
   */
  generateImpl?: (
    prompt: string,
    options?: { temperature?: number; maxTokens?: number; format?: 'json' }
  ) => Promise<string>;
  /**
   * Runtime cap on the number of queries emitted. Clamped to
   * `[1, MAX_QUERIES]`. Used by v3 to toggle "broad queries" mode
   * (3-5 queries) via `V3_MAX_QUERIES` once the semantic gate covers
   * recall. Defaults to `MAX_QUERIES` (20) for backward compat.
   */
  maxQueries?: number;
}

export type QuerySource = 'core' | 'llm' | 'focus' | 'level' | 'subgoal';

export interface SearchQuery {
  query: string;
  source: QuerySource;
  /**
   * Sub_goal cell this query was synthesized for (0..7). Undefined/null when
   * the query is mandala-wide (core/focus/level/llm). Used by executor to
   * tag returned videos with a suggested cell, avoiding the embedding step
   * in the hot path.
   */
  cellIndex?: number | null;
}

// History:
//   - 8 (initial)
//   - 8 → 12 (2026-04-16 PR #400): candidate pool large enough for the
//     mandala filter to produce a natural per-cell distribution.
//   - 12 → 20 (2026-04-18, recall-expansion PR): user report on niche
//     domain ("GraphDB 전문가") had only 17 finalSlots because 12 queries
//     produced too small a pool for cells 5–7 to ever find candidates.
//     The pool roughly scales with queries × ~50 results/query (YouTube
//     search.list max), so 20 queries target ~1000 raw videos → 400–600
//     post-shorts-filter → enough for all 8 cells to find niche matches.
//     20 × search.list (100 units) = 2000 quota/mandala → ~15 mandalas/day
//     across 3 keys (PR #411 rotation). Still in budget for current usage.
//     Further growth gated on Step 2 seed dictionary + API quota uplift.
export const MAX_QUERIES = 20;
export const MAX_QUERY_LENGTH = 100;

const TARGET_LEVEL_KEYWORDS: Record<string, Record<KeywordLanguage, string>> = {
  beginner: { ko: '입문', en: 'beginner' },
  intermediate: { ko: '중급', en: 'intermediate' },
  advanced: { ko: '심화', en: 'advanced' },
  expert: { ko: '전문가', en: 'expert' },
};

/**
 * Build 3-5 search queries for a mandala. Always returns at least 1 (the
 * centerGoal verbatim). LLM failure degrades to rule-based-only — never
 * throws. Caller should treat empty centerGoal as the only error condition.
 */
export async function buildSearchQueries(
  input: KeywordBuilderInput,
  opts: KeywordBuilderOpts = {}
): Promise<SearchQuery[]> {
  const center = input.centerGoal.trim();
  if (!center) return [];

  const candidates: SearchQuery[] = [
    ...buildRuleBasedQueriesSync(input, opts.maxQueries),
    ...(await runLLMQueries(input, opts)),
  ];
  return dedupeAndCap(candidates, opts.maxQueries);
}

/**
 * Synchronous rule-based queries (core + focus + level + subgoal). Used by
 * executor to start YouTube search immediately without waiting for the LLM.
 * Always returns ≥1 entry as long as centerGoal is non-empty.
 */
export function buildRuleBasedQueriesSync(
  input: KeywordBuilderInput,
  maxQueries?: number
): SearchQuery[] {
  const center = input.centerGoal.trim();
  if (!center) return [];
  const out: SearchQuery[] = [];
  out.push({ query: clip(extractCoreKeyphrase(center, input.language)), source: 'core' });
  for (const q of buildRuleBasedQueries(input, center)) out.push(q);
  return dedupeAndCap(out, maxQueries);
}

/**
 * Async LLM queries only. Returns [] on failure or when API key is absent.
 * Kept separate so executor can race it in parallel with YouTube search.
 */
export async function runLLMQueries(
  input: KeywordBuilderInput,
  opts: KeywordBuilderOpts = {}
): Promise<SearchQuery[]> {
  const center = input.centerGoal.trim();
  if (!center) return [];
  if (!opts.openRouterApiKey || !opts.openRouterModel) return [];

  // Use the same C+ prompt (+ OpenRouter Haiku) as v1 for query quality
  // parity. Previous Ollama/OpenRouter race with the simple 2–6 word prompt
  // produced context-losing queries (see comment at top of file).
  const compositeAreaKeyword = buildCompositeAreaKeyword(input);
  const prompt = buildSearchQueryPrompt({
    centerGoal: center,
    subGoal: compositeAreaKeyword,
    language: input.language,
    focusTags: input.focusTags,
    targetLevel: input.targetLevel,
  });
  try {
    // Test injection takes precedence so unit tests don't reach OpenRouter.
    // In real code, OpenRouterGenerationProvider reads OPENROUTER_API_KEY
    // from central config.
    const generate =
      opts.generateImpl ??
      (async (p: string, o?: { temperature?: number; maxTokens?: number; format?: 'json' }) => {
        const provider = new OpenRouterGenerationProvider(SEARCH_QUERY_MODEL);
        return provider.generate(p, o);
      });
    const raw = await generate(prompt, {
      temperature: SEARCH_QUERY_TEMPERATURE,
      maxTokens: SEARCH_QUERY_MAX_TOKENS,
      format: 'json',
    });
    const queries = parseQueriesResponse(raw) ?? [];
    const cap = resolveMaxQueries(opts.maxQueries);
    return queries.slice(0, cap).map((q) => ({ query: clip(q), source: 'llm' as const }));
  } catch (err) {
    log.warn(
      `C+ LLM query failed: ${err instanceof Error ? err.message : String(err)} — falling back to rule-based`
    );
    return [];
  }
}

/**
 * Synthesize "영역 핵심어" — a composite hint string fed as `subGoal` to the
 * existing single-cell C+ prompt. We use focus_tags first (explicit user
 * intent) then the 2 shortest sub_goals (most keyword-like). Falls back to
 * "전반적인 영역" / "general scope" when nothing else exists.
 */
function buildCompositeAreaKeyword(input: KeywordBuilderInput): string {
  const parts: string[] = [];
  for (const t of input.focusTags ?? []) {
    const trimmed = t.trim();
    if (trimmed) parts.push(trimmed);
  }
  for (const sg of pickDistinctiveSubGoals(input.subGoals, 2)) {
    parts.push(sg);
  }
  if (parts.length === 0) {
    return input.language === 'ko' ? '전반적인 영역' : 'general scope';
  }
  // Cap at 60 chars so the LLM prompt stays concise
  return parts.join(', ').slice(0, 60);
}

function buildRuleBasedQueries(input: KeywordBuilderInput, center: string): SearchQuery[] {
  const out: SearchQuery[] = [];
  const focusTags = (input.focusTags ?? []).map((t) => t.trim()).filter(Boolean);
  if (focusTags.length > 0) {
    out.push({
      query: clip(`${center} ${focusTags.slice(0, 2).join(' ')}`),
      source: 'focus',
    });
  }
  const lvlKey = input.targetLevel?.toLowerCase().trim();
  if (lvlKey && lvlKey !== 'standard') {
    const map = TARGET_LEVEL_KEYWORDS[lvlKey];
    if (map) {
      out.push({ query: clip(`${center} ${map[input.language]}`), source: 'level' });
    }
  }
  // 4 → 8 sub_goals (2026-04-16). With the 9-axis mandala filter, the
  // candidate distribution across cells is only as balanced as the query
  // coverage. Covering all 8 sub_goals guarantees every cell has at least
  // one query seeded specifically for it. Niche cells can still come up
  // empty if no relevant video exists — that is the intended honest
  // behavior, not a symptom of missing queries.
  //
  // Issue #543 (2026-04-28): the sub_goal text is condensed to a 2-noun
  // phrase via `extractCoreKeyword` before concatenation. Mandala-gen
  // emits Haiku-natural sentences for sub_goals (e.g. "최적의 공부 환경
  // 구축 및 방해 요소 제거", 22 chars), which when concatenated to the
  // centerGoal produced 30+ char broad-match queries that recalled
  // cross-domain noise (Google One AI 프로젝트 → Nvidia NIM / Intel oneAPI).
  for (const { s, i } of pickDistinctiveSubGoalsWithIndex(input.subGoals, 8)) {
    const coreKw = extractCoreKeyword(s, input.language);
    out.push({ query: clip(`${center} ${coreKw}`), source: 'subgoal', cellIndex: i });
  }
  return out;
}

function clip(s: string): string {
  return s.trim().slice(0, MAX_QUERY_LENGTH);
}

/**
 * Lightweight keyphrase extraction (regex only — no morphological analyzer).
 *
 * Korean: drops 4-digit year prefix, common verbal endings (하기, 되기,
 *   만들기, 배우기, 익히기, 시작하기, 달성하기). Returns the trimmed result.
 *
 * English: lowercases, drops 4-digit year prefix and a small stopword set.
 *
 * Falls back to the original phrase if extraction yields an empty string
 * (e.g. centerGoal was just a year + a stripped verb).
 */
export function extractCoreKeyphrase(phrase: string, language: KeywordLanguage): string {
  const original = phrase.trim();
  if (!original) return '';

  if (language === 'ko') {
    const KO_VERBAL_ENDINGS = [
      '시작하기',
      '달성하기',
      '익히기',
      '배우기',
      '만들기',
      '되기',
      '하기',
    ];
    let s = original
      // strip leading 4-digit year + optional separator
      .replace(/^(19|20)\d{2}\s*[년-]?\s*/u, '')
      // strip leading "올해", "내년"
      .replace(/^(올해|내년)\s+/u, '')
      .trim();
    for (const ending of KO_VERBAL_ENDINGS) {
      if (s.endsWith(ending)) {
        s = s.slice(0, -ending.length).trim();
        break;
      }
    }
    return s.length > 0 ? s : original;
  }

  // English
  const EN_STOPWORDS = new Set([
    'a',
    'an',
    'the',
    'of',
    'in',
    'on',
    'my',
    'your',
    'our',
    'how',
    'to',
  ]);
  let s = original
    .toLowerCase()
    .replace(/^(19|20)\d{2}\s+/u, '')
    .replace(/^(this year|next year)\s+/u, '');
  const tokens = s.split(/\s+/).filter((t) => t && !EN_STOPWORDS.has(t));
  s = tokens.join(' ').trim();
  return s.length > 0 ? s : original;
}

// Korean stopword sets used by `extractCoreKeyword` to condense a sub_goal
// natural-language sentence into a short keyword phrase. Three layers:
//   1. KO_VERBAL_ENDINGS — drop the entire token if it ends with one of these
//      (e.g. "정의하기" → drop, "향상시키기" → drop).
//   2. KO_POSTPOSITION_ENDINGS — strip the suffix from the token (multi-char
//      only; single-char particles like "을/를" are skipped to avoid false
//      strips on nouns ending in those characters).
//   3. KO_STOPWORDS_EXACT — drop the token outright on exact match
//      (light verbs, modifiers, conjunctions).
const KO_VERBAL_ENDINGS = [
  '시작하기',
  '달성하기',
  '강화하기',
  '개선하기',
  '시키기',
  '높이기',
  '늘리기',
  '줄이기',
  '익히기',
  '배우기',
  '만들기',
  '되기',
  '하기',
  '정하고',
];
const KO_POSTPOSITION_ENDINGS = ['으로', '에서', '에게', '부터', '까지'];
const KO_STOPWORDS_EXACT = new Set<string>([
  '및',
  '또는',
  '으로',
  '에서',
  '에게',
  '부터',
  '까지',
  '이며',
  '하여',
  '구축',
  '제거',
  '향상',
  '극대화',
  '활용',
  '정의',
  '통해',
  '위한',
  '위해',
  '명확히',
  '효율적인',
  '최적의',
  '매일',
  '꾸준히',
  '체계적으로',
]);

/**
 * Condense a sub_goal natural-language phrase into a short 2-noun keyword
 * for YouTube search. Issue #543: prod incident showed sentences like "최적의
 * 공부 환경 구축 및 방해 요소 제거" (22 chars) when concatenated with the
 * centerGoal produced broad-match queries that recalled cross-domain noise.
 *
 * Strategy:
 *   - Drop tokens that match exact stopwords (modifiers, conjunctions).
 *   - Drop tokens that end with a verbal ending (whole token, e.g. 정의하기).
 *   - Strip multi-char postposition suffixes (으로/에서/...).
 *   - Take the first 2 surviving tokens, cap at 10 chars.
 *   - Empty fallback → `extractCoreKeyphrase` (centerGoal logic).
 *
 * English / non-Hangul input passes through `extractCoreKeyphrase('en')` —
 * the centerGoal-targeted stopword set is good enough for short sub_goals.
 */
export function extractCoreKeyword(subGoal: string, language: KeywordLanguage): string {
  const original = subGoal.trim();
  if (!original) return '';
  if (language === 'en' || !/[가-힯]/u.test(original)) {
    return extractCoreKeyphrase(original, 'en');
  }
  const tokens = original.split(/\s+/u).filter(Boolean);
  const kept: string[] = [];
  for (const raw of tokens) {
    if (KO_STOPWORDS_EXACT.has(raw)) continue;
    let endsWithVerbal = false;
    for (const ve of KO_VERBAL_ENDINGS) {
      if (raw.endsWith(ve)) {
        endsWithVerbal = true;
        break;
      }
    }
    if (endsWithVerbal) continue;
    let stripped = raw;
    for (const pp of KO_POSTPOSITION_ENDINGS) {
      if (raw.length > pp.length + 1 && raw.endsWith(pp)) {
        stripped = raw.slice(0, -pp.length);
        break;
      }
    }
    if (stripped) kept.push(stripped);
  }
  let result = kept.slice(0, 2).join(' ').trim();
  if (!result) return extractCoreKeyphrase(original, 'ko');
  if (result.length > 10) result = result.slice(0, 10).trim();
  return result;
}

/** Shortest sub_goals first (≤30 chars). Stable on ties. */
function pickDistinctiveSubGoals(subGoals: string[], n: number): string[] {
  return pickDistinctiveSubGoalsWithIndex(subGoals, n).map((x) => x.s);
}

/**
 * Same as `pickDistinctiveSubGoals` but preserves the original sub_goal index
 * (0..7) so the caller can tag the resulting query with a cell_index.
 */
function pickDistinctiveSubGoalsWithIndex(
  subGoals: string[],
  n: number
): Array<{ s: string; i: number }> {
  const cleaned = subGoals
    .map((s, i) => ({ s: s.trim(), i }))
    .filter((x) => x.s.length > 0 && x.s.length <= 30);
  cleaned.sort((a, b) => a.s.length - b.s.length || a.i - b.i);
  return cleaned.slice(0, n);
}

function dedupeAndCap(candidates: SearchQuery[], maxQueries?: number): SearchQuery[] {
  const cap = resolveMaxQueries(maxQueries);
  const seen = new Set<string>();
  const out: SearchQuery[] = [];
  for (const c of candidates) {
    const norm = c.query.toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
}

function resolveMaxQueries(requested: number | undefined): number {
  if (!Number.isFinite(requested) || !requested || requested <= 0) return MAX_QUERIES;
  return Math.min(Math.floor(requested), MAX_QUERIES);
}
