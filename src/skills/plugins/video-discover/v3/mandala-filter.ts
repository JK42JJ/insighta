/**
 * v3 Mandala Filter — 9-axis relevance gate for candidate videos.
 *
 * Philosophy (2026-04-16): collect wide, filter via the mandala itself
 * (1 centerGoal + 8 sub_goals). The mandala structure IS the filter.
 *
 *   Gate 1 (center, substring-match): the title must contain at least one
 *     token from extractCoreKeyphrase(centerGoal). Substring match — so
 *     "수능" admits "수능특강" but not "한능검".
 *     Rejects off-domain candidates (e.g. "하느님 자비의 기도" in a
 *     "일일 습관 성장" mandala).
 *
 *   Gate 2 (sub_goal, jaccard): title+description must overlap with one of
 *     the 8 sub_goals above MIN_SUB_RELEVANCE. The best-fit sub_goal
 *     becomes the cell assignment (argmax).
 *
 * Final score = 0.5 · centerScore + 0.5 · bestCellScore ∈ [0, 1].
 * The downstream consumer sorts per-cell score desc and takes top-N.
 * Empty cells stay empty — we never fill with garbage.
 */

import { extractCoreKeyphrase, type KeywordLanguage } from '../v2/keyword-builder';

/** Minimum jaccard overlap with a sub_goal for a candidate to be routed. */
export const MIN_SUB_RELEVANCE = 0.05;

/** Shape the filter needs — any candidate source (pool, search, future). */
export interface FilterCandidate {
  videoId: string;
  title: string;
  description: string | null;
}

export interface ScoredAssignment<T extends FilterCandidate> {
  candidate: T;
  cellIndex: number;
  /** Final score, range 0..1, used for per-cell ranking. */
  score: number;
  /** Gate 1 component. */
  centerScore: number;
  /** Gate 2 component (best sub_goal jaccard). */
  cellScore: number;
}

export interface MandalaFilterInput {
  centerGoal: string;
  subGoals: ReadonlyArray<string>; // length 8
  language: KeywordLanguage;
}

/**
 * Apply the 9-axis mandala filter. Returns assignments grouped by cell,
 * each list sorted by score desc. Drops candidates that fail the center
 * gate or don't clear MIN_SUB_RELEVANCE on any sub_goal.
 */
/**
 * Diagnostic stats from a single applyMandalaFilter run. No behavior impact.
 * Mutated by `applyMandalaFilterWithStats`. Added 2026-04-17 for dev/prod
 * divergence analysis.
 */
export interface MandalaFilterStats {
  input: number;
  output: number;
  droppedByCenterGate: number;
  droppedByJaccardBelowThreshold: number;
  centerTokens: string[];
  subGoalTokenCounts: number[];
}

export function applyMandalaFilter<T extends FilterCandidate>(
  candidates: ReadonlyArray<T>,
  input: MandalaFilterInput
): Map<number, ScoredAssignment<T>[]> {
  return applyMandalaFilterWithStats(candidates, input).byCell;
}

export function applyMandalaFilterWithStats<T extends FilterCandidate>(
  candidates: ReadonlyArray<T>,
  input: MandalaFilterInput
): { byCell: Map<number, ScoredAssignment<T>[]>; stats: MandalaFilterStats } {
  const centerCore = extractCoreKeyphrase(input.centerGoal, input.language);
  const centerTokens = tokenize(centerCore, input.language);

  const subGoalTokens: Set<string>[] = input.subGoals.map((sg) => tokenize(sg, input.language));

  const byCell = new Map<number, ScoredAssignment<T>[]>();
  for (let i = 0; i < input.subGoals.length; i++) byCell.set(i, []);

  const stats: MandalaFilterStats = {
    input: candidates.length,
    output: 0,
    droppedByCenterGate: 0,
    droppedByJaccardBelowThreshold: 0,
    centerTokens: [...centerTokens],
    subGoalTokenCounts: subGoalTokens.map((s) => s.size),
  };

  for (const c of candidates) {
    const titleTokens = tokenize(c.title, input.language);
    const centerScore = substringOverlap(centerTokens, titleTokens);
    if (centerTokens.size > 0 && centerScore === 0) {
      stats.droppedByCenterGate++;
      continue;
    }

    const bodyTokens = tokenize(`${c.title} ${c.description ?? ''}`, input.language);

    let bestCell = -1;
    let bestScore = 0;
    for (let i = 0; i < subGoalTokens.length; i++) {
      const sg = subGoalTokens[i];
      if (!sg) continue;
      const s = jaccard(bodyTokens, sg);
      if (s > bestScore) {
        bestScore = s;
        bestCell = i;
      }
    }
    if (bestCell === -1 || bestScore < MIN_SUB_RELEVANCE) {
      stats.droppedByJaccardBelowThreshold++;
      continue;
    }

    const final = 0.5 * centerScore + 0.5 * bestScore;
    byCell.get(bestCell)!.push({
      candidate: c,
      cellIndex: bestCell,
      score: final,
      centerScore,
      cellScore: bestScore,
    });
    stats.output++;
  }

  for (const list of byCell.values()) {
    list.sort((a, b) => b.score - a.score);
  }
  return { byCell, stats };
}

/**
 * Substring overlap between center tokens and title tokens. Any pair where
 * one is a substring of the other counts as a hit. This lets "수능" admit
 * compound words like "수능특강" while still rejecting "한능검".
 * Returns hits / centerTokens.size ∈ [0, 1].
 */
function substringOverlap(centerTokens: Set<string>, titleTokens: Set<string>): number {
  if (centerTokens.size === 0) return 0;
  let hits = 0;
  for (const ct of centerTokens) {
    for (const tt of titleTokens) {
      if (tt.includes(ct) || ct.includes(tt)) {
        hits++;
        break;
      }
    }
  }
  return hits / centerTokens.size;
}

function jaccard(bodyTokens: Set<string>, subGoalTokens: Set<string>): number {
  if (bodyTokens.size === 0 || subGoalTokens.size === 0) return 0;
  let hits = 0;
  for (const t of subGoalTokens) if (bodyTokens.has(t)) hits++;
  return hits / subGoalTokens.size;
}

const KO_STOPWORDS = new Set([
  '및',
  '등',
  '하기',
  '되기',
  '관련',
  '방법',
  '위한',
  '통한',
  '이상',
  '이하',
  '대해',
  '으로',
  '에서',
  '에게',
  '한다',
  '있다',
  '없다',
  '그리고',
  '하지만',
  '또한',
]);
const EN_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'by',
  'and',
  'or',
  'but',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'from',
  'as',
  'it',
]);

function tokenize(text: string, language: KeywordLanguage): Set<string> {
  if (!text) return new Set();
  const stops = language === 'ko' ? KO_STOPWORDS : EN_STOPWORDS;
  const cleaned = text
    .toLowerCase()
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2 && !stops.has(t));
  return new Set(tokens);
}
