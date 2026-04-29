/**
 * v2 Rich-Summary Quality Metrics — paper §6.2 measurement (CP437).
 *
 * Per-event per-video metrics emitted to `pipeline_events` table. Round-keyed
 * for batch-to-batch comparison (Round 1 = initial 20 CC-direct samples;
 * Round 2+ = subsequent batches over the 1,507 v1-only videos).
 *
 * Spec (user-provided 2026-04-29):
 *   M1       — title-word recall in atom texts. Stopword-stripped, ratio of
 *              title content tokens that appear anywhere across the
 *              concatenated atoms text. 0..1.
 *   M3_class — quality classification of segments.atoms:
 *              all_null      — atoms missing or all timestamp_sec === null
 *              uniform_fake  — all atom.text identical or near-identical
 *              insufficient  — fewer than MIN_ATOMS_REAL atoms
 *              mixed         — partial coverage (some null timestamps + some real)
 *              real          — ≥ MIN_ATOMS_REAL atoms with varied text
 *   M3_score — { all_null:0, uniform_fake:0, insufficient:0, mixed:0.5,
 *                real: 1 - null_ratio }
 *   S        — 0.55 * M1 + 0.45 * M3_score (composite quality)
 *
 * Hard Rule: pure function. No I/O, no LLM call, no embedding. Deterministic
 * and side-effect-free so it's safe to call from the upsert-direct route or
 * a backfill script.
 */

/**
 * Korean particles (조사) attached to title content words. Single-character
 * particles that are also valid content nouns (도 = degree, 나 = I/me) are
 * INTENTIONALLY EXCLUDED — without morphological analysis we'd kill content
 * tokens like "의도" (intent → strip 도 → "의" → stopword filter drop).
 * The ambiguous-strip cost for these particles is small (e.g. "오늘도"
 * staying as "오늘도" instead of "오늘") compared to the content lost when
 * we keep them.
 */
export const STOPWORDS_KO: ReadonlySet<string> = new Set([
  '은',
  '는',
  '이',
  '가',
  '을',
  '를',
  '에',
  '에서',
  '에게',
  '에겐',
  '한테',
  '께',
  '와',
  '과',
  '의',
  '로',
  '으로',
  '만',
  '까지',
  '부터',
  '같이',
  '처럼',
  '보다',
  '마저',
  '조차',
  '뿐',
  '마다',
  '씩',
  '이나',
  '이며',
  '며',
  '이자',
  '와의',
  '과의',
]);

const MIN_ATOMS_REAL = 3;
/**
 * General minimum content-token length. Korean single-syllable nouns
 * (돈/책/물/산/길 etc) are common content words but only 1 char wide,
 * so we apply the 2-char threshold conditionally — see `isKoreanChar`.
 */
const TITLE_MIN_TOKEN_LEN = 2;
const TITLE_MIN_TOKEN_LEN_KO = 1;

/** Hangul (가-힣) + CJK ideographs → treated as Korean. */
function isKoreanChar(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x4e00 && c <= 0x9fff);
}

function isKoreanToken(token: string): boolean {
  for (const ch of token) {
    if (isKoreanChar(ch)) return true;
  }
  return false;
}

/**
 * Decode the small set of HTML entities that appear in YouTube titles
 * pulled via the Data API. Without this, `&#39;나&#39;` tokenizes to
 * `['39','나']` instead of `['나']`, which destroys M1 recall.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export type M3Class = 'all_null' | 'uniform_fake' | 'insufficient' | 'mixed' | 'real';

export interface V2QualityResult {
  M1: number;
  M3_class: M3Class;
  M3_score: number;
  S: number;
  null_ratio: number;
  /** Diagnostic counts so audits can re-derive the score. */
  meta: {
    title_tokens: number;
    atoms_total: number;
    atoms_with_ts: number;
    unique_text_count: number;
  };
}

export interface V2Atom {
  text?: string;
  timestamp_sec?: number | null;
  [k: string]: unknown;
}

export interface V2QualityInput {
  title: string;
  atoms: V2Atom[];
}

/**
 * Strip a Korean particle suffix from a token if exactly one of STOPWORDS_KO
 * is the longest matching suffix. Tokens shorter than 2 chars are returned
 * as-is. Returns null when the post-strip stem is too short to count.
 */
function stripKoreanParticle(token: string): string | null {
  // Use Korean-aware min length so single-syllable nouns survive.
  const minLen = isKoreanToken(token) ? TITLE_MIN_TOKEN_LEN_KO : TITLE_MIN_TOKEN_LEN;
  if (token.length < minLen) return null;
  // Sort stopwords by length desc so '으로' wins over '로'
  const candidates = [...STOPWORDS_KO].sort((a, b) => b.length - a.length);
  for (const sw of candidates) {
    if (token.length > sw.length && token.endsWith(sw)) {
      const stem = token.slice(0, token.length - sw.length);
      // If the stripped stem is too short for its language class (e.g.
      // '의도' → '도' is too short for Korean meaningful content), the
      // suffix was likely the second character of a content word, not a
      // particle. Keep the original token in that case.
      const stemMin = isKoreanToken(stem) ? TITLE_MIN_TOKEN_LEN_KO : TITLE_MIN_TOKEN_LEN;
      if (stem.length < stemMin) return token;
      return stem;
    }
  }
  return token;
}

/**
 * Tokenize title into content tokens. Pipeline:
 *   1. HTML-entity decode (`&#39;` → `'` etc) so YouTube-encoded titles
 *      tokenize on the actual content characters.
 *   2. Lowercase (Latin only).
 *   3. Split on whitespace + punctuation, including the Korean vertical
 *      bar `ㅣ` (U+3163) and full-width pipe `｜` (U+FF5C) which appear in
 *      titles like "투자 전략ㅣ지식인초대석".
 *   4. Drop tokens shorter than the language-aware min (Korean=1, EN=2).
 *   5. Strip particles, dedupe, drop pure-stopword tokens.
 */
export function extractTitleTokens(title: string): string[] {
  if (!title) return [];
  const decoded = decodeHtmlEntities(title);
  const raw = decoded
    .toLowerCase()
    .split(/[\s\-_·,/()[\]{}<>!?@#$%^&*+=|\\~`"'.;:ㅣ｜]+/u)
    .filter((t) => t.length >= (isKoreanToken(t) ? TITLE_MIN_TOKEN_LEN_KO : TITLE_MIN_TOKEN_LEN));
  const out = new Set<string>();
  for (const t of raw) {
    const stem = stripKoreanParticle(t);
    if (stem && !STOPWORDS_KO.has(stem)) out.add(stem);
  }
  return [...out];
}

/**
 * Compute M1: fraction of title tokens that appear (substring match) in the
 * concatenated atom text. Returns 0 when title yields no tokens.
 */
export function computeM1(input: V2QualityInput): number {
  const tokens = extractTitleTokens(input.title);
  if (tokens.length === 0) return 0;
  const blob = (input.atoms ?? [])
    .map((a) => (typeof a.text === 'string' ? a.text.toLowerCase() : ''))
    .join('\n');
  if (blob.length === 0) return 0;
  let hit = 0;
  for (const t of tokens) {
    if (blob.includes(t)) hit += 1;
  }
  return hit / tokens.length;
}

function computeM3(input: V2QualityInput): {
  cls: M3Class;
  score: number;
  null_ratio: number;
  unique_text_count: number;
  atoms_with_ts: number;
} {
  const atoms = input.atoms ?? [];
  if (atoms.length === 0) {
    return {
      cls: 'all_null',
      score: 0,
      null_ratio: 1,
      unique_text_count: 0,
      atoms_with_ts: 0,
    };
  }
  const atoms_with_ts = atoms.filter((a) => typeof a.timestamp_sec === 'number').length;
  const null_ratio = (atoms.length - atoms_with_ts) / atoms.length;
  const texts = atoms.map((a) => (typeof a.text === 'string' ? a.text.trim() : ''));
  const uniqueTexts = new Set(texts.filter((t) => t.length > 0));
  const unique_text_count = uniqueTexts.size;

  if (atoms_with_ts === 0) {
    return { cls: 'all_null', score: 0, null_ratio, unique_text_count, atoms_with_ts };
  }
  if (uniqueTexts.size <= 1) {
    return { cls: 'uniform_fake', score: 0, null_ratio, unique_text_count, atoms_with_ts };
  }
  if (atoms.length < MIN_ATOMS_REAL) {
    return { cls: 'insufficient', score: 0, null_ratio, unique_text_count, atoms_with_ts };
  }
  if (atoms_with_ts < atoms.length) {
    return { cls: 'mixed', score: 0.5, null_ratio, unique_text_count, atoms_with_ts };
  }
  return { cls: 'real', score: 1 - null_ratio, null_ratio, unique_text_count, atoms_with_ts };
}

/** Compose the full V2QualityResult including S = 0.55*M1 + 0.45*M3_score. */
export function computeV2Quality(input: V2QualityInput): V2QualityResult {
  const tokens = extractTitleTokens(input.title);
  const M1 = computeM1(input);
  const m3 = computeM3(input);
  const S = 0.55 * M1 + 0.45 * m3.score;
  return {
    M1,
    M3_class: m3.cls,
    M3_score: m3.score,
    S,
    null_ratio: m3.null_ratio,
    meta: {
      title_tokens: tokens.length,
      atoms_total: (input.atoms ?? []).length,
      atoms_with_ts: m3.atoms_with_ts,
      unique_text_count: m3.unique_text_count,
    },
  };
}
