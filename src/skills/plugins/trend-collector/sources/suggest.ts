/**
 * trend-collector — YouTube Search Suggest source (Phase 1.5a, Decision 2)
 *
 * Calls the unofficial YouTube autocomplete endpoint:
 *   https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q={term}
 *
 * Quota cost: 0 (this is the legacy autocomplete endpoint, NOT the v3
 * search.list which costs 100 units/call). It returns a JSONP-wrapped
 * payload of the form:
 *
 *   window.google.ac.h([
 *     "파이썬",                                  ← original query
 *     [
 *       ["파이썬 기초", 0, [512,433,131]],        ← [suggestion, type, flags]
 *       ["파이썬 강의", 0, [512,433,131]],
 *       ...
 *     ]
 *   ])
 *
 * The suggestions ARE the trend signals — Phase 1's Q2 design flaw was using
 * video titles as keywords. Suggest returns real user search-intent phrases
 * which is exactly what trend_signals.keyword should be.
 *
 * Stability note: this endpoint is undocumented but has been stable for years
 * and is hit by every YouTube autocomplete dropdown in the world. We treat
 * any failure as soft (caller falls back / continues), never throw.
 */

const SUGGEST_BASE_URL = 'https://suggestqueries.google.com/complete/search';
// Reasonable browser UA — endpoint sometimes returns nothing for empty UA
const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0';
const SUGGEST_TIMEOUT_MS = 5000;

export interface SuggestionItem {
  /** The autocomplete suggestion text — already a search-intent keyword. */
  text: string;
  /** Position in the suggest list (0 = first/most likely). */
  position: number;
}

export interface FetchSuggestionsOptions {
  query: string;
  /** Suggest API hl param. Defaults to 'ko'. */
  language?: string;
  /** Injectable fetch for testability. */
  fetchImpl?: typeof fetch;
}

export class SuggestFetchError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'SuggestFetchError';
  }
}

/**
 * Fetch autocomplete suggestions for a single query term.
 *
 * Returns at most ~10-15 suggestions (whatever YouTube returns). Empty
 * array on no suggestions (rare for common terms but possible for niche
 * ones). Throws SuggestFetchError only on transport-level failure.
 */
export async function fetchSuggestions(opts: FetchSuggestionsOptions): Promise<SuggestionItem[]> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const language = opts.language ?? 'ko';

  const url = new URL(SUGGEST_BASE_URL);
  url.searchParams.set('client', 'youtube');
  url.searchParams.set('ds', 'yt');
  url.searchParams.set('q', opts.query);
  url.searchParams.set('hl', language);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUGGEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetchFn(url.toString(), {
      headers: { 'User-Agent': DEFAULT_UA },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new SuggestFetchError(
      `Suggest fetch failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw new SuggestFetchError(`Suggest HTTP ${res.status}`, res.status);
  }

  const body = await res.text();
  return parseJsonpResponse(body);
}

/**
 * Parse the JSONP-wrapped response into SuggestionItem[].
 *
 * Format: `window.google.ac.h(["query",[["sug1",0,[...]],["sug2",0,[...]]]])`
 *
 * Strategy:
 *   1. Strip the `window.google.ac.h(` prefix and trailing `)`
 *   2. JSON.parse the inner array
 *   3. The inner shape is [query, suggestions[]]
 *   4. Each suggestion is [text, type?, flags?] — we only need text
 *
 * Returns empty array on any parse failure (defensive — endpoint sometimes
 * returns empty `()` for niche terms).
 */
export function parseJsonpResponse(body: string): SuggestionItem[] {
  if (!body || body.length === 0) return [];

  const prefix = 'window.google.ac.h(';
  const suffix = ')';
  if (!body.startsWith(prefix) || !body.endsWith(suffix)) return [];

  const inner = body.slice(prefix.length, -suffix.length);
  if (inner.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed) || parsed.length < 2) return [];
  const suggestions = parsed[1];
  if (!Array.isArray(suggestions)) return [];

  const out: SuggestionItem[] = [];
  for (let i = 0; i < suggestions.length; i++) {
    const item = suggestions[i];
    if (Array.isArray(item) && typeof item[0] === 'string' && item[0].length > 0) {
      out.push({ text: item[0], position: i });
    }
  }
  return out;
}

/**
 * Score normalization for Suggest results.
 *
 * Higher position (lower index) = stronger signal. Linear inverse:
 *   position 0  → 1.0
 *   position 1  → 0.9
 *   position 5  → 0.5
 *   position 9+ → 0.1
 *
 * This is the raw_score and norm_score for trend_signals (already in [0,1]).
 */
export function suggestPositionToScore(position: number): number {
  if (position < 0) return 0;
  // Linear from 1.0 (pos 0) to 0.1 (pos 9), floor 0.05 beyond
  const score = 1.0 - position * 0.1;
  return score < 0.05 ? 0.05 : score;
}
