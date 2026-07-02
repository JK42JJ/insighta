/**
 * Per-cell `to_tsquery('simple', …)` builder + W2 generic-filler stopwords.
 *
 * Extracted from hybrid-rerank.ts as a PURE module (no `@/` imports) so the
 * tokenizer + stopword list are unit-testable in isolation.
 *
 * W2 precision (2026-07-02): the stopword set is the empirically top-frequency
 * NON-topic tokens across all mandala cell goals (each appears in ~1.5–9% of
 * ~2,430 cells). An OR-tsquery that includes these matches cross-domain videos
 * (e.g. a "강화" self-help clip pulled into a "해외주식 … 역량 강화" finance
 * cell), diluting recruit precision. Dropping them tightens the query to
 * topical nouns — with a guard so a generic-only cell never empties to 0 recall.
 */

export const TSQUERY_GENERIC_STOPWORDS = new Set<string>([
  '학습',
  '관리',
  '전략',
  '구축',
  '분석',
  '최적화',
  '수립',
  '능력',
  '위한',
  '습득',
  '기초',
  '강화',
  '계획',
  '이해',
  '확보',
  '준비',
  '개선',
  '심화',
  '설계',
  '설정',
  '문제',
  '목표',
  '정리',
  '유지',
  '핵심',
  '구성',
  '통한',
  '활용',
  '기법',
  '방법',
  '마스터',
  '완성',
  '실천',
  '도전',
  '과정',
  '단계',
  '달성',
  '되기',
  '전문가',
]);

/**
 * Build a Postgres `to_tsquery('simple', …)` OR-string from free text.
 * Tokenization mirrors the inline logic of tsvectorKeywordCandidates
 * (hybrid-rerank ~172-178). Returns '' when no usable token remains.
 */
export function buildTsqueryString(text: string): string {
  const tokens = text
    .split(/[\s,/.;()[\]{}!?"'`~&|<>:*+\-=]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/[':!&|()<>*]/g, ''))
    .filter((t) => t.length > 0)
    .filter((t, i, arr) => arr.indexOf(t) === i);
  // W2 precision: drop generic-filler tokens. Guard — if a cell's tokens are
  // ALL generic, keep the original set so recall never collapses to empty.
  const topical = tokens.filter((t) => !TSQUERY_GENERIC_STOPWORDS.has(t));
  return (topical.length > 0 ? topical : tokens).join(' | ');
}
