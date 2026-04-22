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
 *
 * 2026-04-18 amendments — "뇌" / focus-tag bug (Issue #414):
 *   - `tokenize` had `t.length >= 2` which silently dropped 1-char Korean
 *     meaningful tokens (뇌, 책, 돈, 법, 길, 꿈). Ex: "AI 시대의 뇌 활용법"
 *     tokens became ["ai","시대의","활용법"] — missing the real subject.
 *   - `focus_tags` from the wizard never reached the filter; "박문호 강연"
 *     videos collected by the focus query were dropped at the center gate
 *     because their titles contain neither "ai" nor "시대의" nor "활용법".
 *   - Fixes: (1) 1-char Hangul allowed in tokenize; (2) focusTags are an
 *     OR condition with the center gate (explicit user intent can bypass
 *     center substring). Non-focus candidates still use the pre-existing
 *     "any overlap > 0" rule, so the change is strictly permissive — it
 *     only adds candidates to the pool, never removes them. Raising the
 *     center threshold to drop "ai-only" noise is left to a future scoring
 *     pass because the same threshold would also drop legitimate
 *     single-token hits like "한식" in "요리 입문자 한식 마스터".
 */

import { extractCoreKeyphrase, type KeywordLanguage } from '../v2/keyword-builder';
import { MS_PER_MONTH_AVG } from '@/utils/time-constants';
import type { CenterGateMode } from './config';

export const MIN_SUB_RELEVANCE = 0.05;

/**
 * Cosine-similarity threshold for the `'semantic'` center-gate mode.
 * A candidate passes when cosine(centerEmbedding, titleEmbedding) ≥ this.
 *
 * 0.35 chosen as a permissive floor — qwen3-embedding:8b in-domain pairs
 * typically score 0.5-0.8 (e.g. `"하루 루틴으로 전문가되기"` ↔
 * `"모닝 루틴 7가지"` ≈ 0.62), cross-domain unrelated pairs score
 * 0.05-0.20 (e.g. `"하루 루틴"` ↔ `"ArgoCD 설치"` ≈ 0.12). 0.35 admits
 * paraphrases that the subword 2-gram gate (recall 0.27) dropped while
 * keeping clear off-domain noise out. Tune via env once telemetry lands.
 */
export const SEMANTIC_MIN_COSINE = 0.35;

export const DEFAULT_RECENCY_WEIGHT = 0.15;

// 18mo half-life: 1y → 0.63, 3y → 0.25, 6y → 0.06.
export const DEFAULT_RECENCY_HALF_LIFE_MONTHS = 18;

/**
 * Character-bigram threshold for the `'subword'` center-gate mode.
 * A center token is considered matched when this fraction (or more)
 * of its 2-grams appear in the title's combined 2-gram bag.
 *
 * 0.3 picked from the fixture sweep in
 * `scripts/verify-mandala-filter-hypothesis.ts` — 0.3 keeps composite
 * matches like `"모닝루틴"` ↔ `"루틴으로"` (2 shared 2-grams of 3)
 * while rejecting single-character incidental overlaps. Lower values
 * start letting NOISE through.
 */
export const SUBWORD_MIN_CENTER_MATCH = 0.3;

export interface FilterCandidate {
  videoId: string;
  title: string;
  description: string | null;
  publishedAt?: Date | null;
}

export interface ScoredAssignment<T extends FilterCandidate> {
  candidate: T;
  cellIndex: number;
  score: number;
  centerScore: number;
  cellScore: number;
  recencyScore: number;
}

export interface MandalaFilterInput {
  centerGoal: string;
  subGoals: ReadonlyArray<string>; // length 8
  language: KeywordLanguage;
  focusTags?: ReadonlyArray<string>;
  recencyWeight?: number;
  recencyHalfLifeMonths?: number;
  now?: Date;
  /**
   * Center-gate matching mode. See `v3/config.ts::CenterGateMode`.
   * Defaults to `'substring'` (pre-audit behavior) when omitted so
   * callers that haven't opted in keep the old logic bit-identical.
   */
  centerGateMode?: CenterGateMode;
  /**
   * Center goal embedding (4096d qwen3-embedding:8b). Required when
   * `centerGateMode === 'semantic'`. When omitted in semantic mode the
   * filter falls back to `'substring'` behavior for safety.
   */
  centerEmbedding?: ReadonlyArray<number>;
  /**
   * Per-candidate title embeddings, keyed by videoId (same 4096d space
   * as `centerEmbedding`). Candidates missing an entry are treated as
   * `centerScore = 0` in semantic mode — they still pass if matched via
   * focusTag, otherwise are dropped by the center gate.
   */
  candidateEmbeddings?: ReadonlyMap<string, ReadonlyArray<number>>;
  /**
   * Override for `SEMANTIC_MIN_COSINE` so admins/tests can tune the
   * threshold without code changes. Clamped to [0, 1].
   */
  semanticMinCosine?: number;
}

export interface ScoreWeights {
  wCenter: number;
  wCell: number;
  wRecency: number;
}

export function buildScoreWeights(recencyWeight: number): ScoreWeights {
  if (!(recencyWeight > 0)) return { wCenter: 0.5, wCell: 0.5, wRecency: 0 };
  const clamped = Math.min(recencyWeight, 1);
  const remaining = 1 - clamped;
  return { wCenter: 0.5 * remaining, wCell: 0.5 * remaining, wRecency: clamped };
}

export function computeRecencyScore(
  publishedAt: Date | null | undefined,
  now: Date,
  halfLifeMonths: number
): number {
  if (!publishedAt) return 0;
  const ageMs = now.getTime() - publishedAt.getTime();
  if (ageMs <= 0) return 1;
  const ageMonths = ageMs / MS_PER_MONTH_AVG;
  return Math.pow(0.5, ageMonths / halfLifeMonths);
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
  /** How many candidates passed the gate via focusTag match (2026-04-18). */
  passedByFocusTag?: number;
  focusTokens?: string[];
  recency?: {
    weight: number;
    halfLifeMonths: number;
    missingPublishedAt: number;
  };
  /** Which mode was applied this run. Useful for prod A/B logs. */
  centerGateMode?: CenterGateMode;
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
  const requestedMode: CenterGateMode = input.centerGateMode ?? 'substring';

  // Safety fallback: `'semantic'` requires a center embedding. Callers that
  // opt into the mode but failed to provide one degrade to `'substring'`
  // rather than silently dropping every candidate.
  const mode: CenterGateMode =
    requestedMode === 'semantic' && !input.centerEmbedding ? 'substring' : requestedMode;

  const semanticMinCosineRaw = input.semanticMinCosine ?? SEMANTIC_MIN_COSINE;
  const semanticMinCosine = Number.isFinite(semanticMinCosineRaw)
    ? Math.max(0, Math.min(1, semanticMinCosineRaw))
    : SEMANTIC_MIN_COSINE;

  // Precompute per-center-token 2-grams once so the subword path is
  // O(title-tokens × centerTokens) per candidate, not per pair.
  const centerTokenGrams: Array<{ token: string; grams: Set<string> }> =
    mode === 'subword' ? [...centerTokens].map((t) => ({ token: t, grams: charBigrams(t) })) : [];

  const subGoalTokens: Set<string>[] = input.subGoals.map((sg) => tokenize(sg, input.language));

  // Build focus-tag tokens. Each tag is tokenised individually so a
  // multi-word tag ("뇌과학 기초") contributes all its component tokens.
  const focusTokens = new Set<string>();
  for (const raw of input.focusTags ?? []) {
    for (const t of tokenize(raw, input.language)) focusTokens.add(t);
  }

  const recencyWeightRaw = input.recencyWeight ?? DEFAULT_RECENCY_WEIGHT;
  const recencyWeight = Number.isFinite(recencyWeightRaw)
    ? Math.max(0, Math.min(1, recencyWeightRaw))
    : 0;
  const halfLifeMonths = Math.max(
    1,
    input.recencyHalfLifeMonths ?? DEFAULT_RECENCY_HALF_LIFE_MONTHS
  );
  const weights = buildScoreWeights(recencyWeight);
  const now = input.now ?? new Date();

  const byCell = new Map<number, ScoredAssignment<T>[]>();
  for (let i = 0; i < input.subGoals.length; i++) byCell.set(i, []);

  const stats: MandalaFilterStats = {
    input: candidates.length,
    output: 0,
    droppedByCenterGate: 0,
    droppedByJaccardBelowThreshold: 0,
    centerTokens: [...centerTokens],
    subGoalTokenCounts: subGoalTokens.map((s) => s.size),
    passedByFocusTag: 0,
    focusTokens: [...focusTokens],
    recency: {
      weight: recencyWeight,
      halfLifeMonths,
      missingPublishedAt: 0,
    },
    centerGateMode: mode,
  };

  for (const c of candidates) {
    const titleTokens = tokenize(c.title, input.language);
    // Center score per mode:
    //   substring — legacy, token-level substring overlap
    //   subword   — char 2-gram overlap per center token, 30% floor
    //   off       — 1 always (gate disabled)
    //   semantic  — cosine(centerEmbedding, titleEmbedding), 0 when missing
    let centerScore: number;
    if (mode === 'off') {
      centerScore = 1;
    } else if (mode === 'subword') {
      centerScore = subwordOverlap(centerTokenGrams, titleTokens);
    } else if (mode === 'semantic') {
      const titleVec = input.candidateEmbeddings?.get(c.videoId);
      // Fallback to substring is handled at mode resolution above when
      // centerEmbedding is missing entirely; here we only guard the
      // per-candidate vector.
      if (!titleVec || !input.centerEmbedding) {
        centerScore = 0;
      } else {
        const cos = cosineSimilarity(input.centerEmbedding, titleVec);
        centerScore = cos >= semanticMinCosine ? cos : 0;
      }
    } else {
      centerScore = substringOverlap(centerTokens, titleTokens);
    }
    const focusMatched = focusTokens.size > 0 && substringOverlap(focusTokens, titleTokens) > 0;

    // Center gate — OR of (focus-tag match) and (center overlap > 0).
    // Focus-tag match bypasses the center gate entirely: if the user
    // explicitly said "박문호" we trust that signal over lexical centerGoal
    // overlap, so "박문호 교수의 뇌 과학 강연" passes even without "AI 시대의"
    // in the title. Non-focus candidates keep the original "any overlap"
    // rule so this change is purely additive on the permissive side — the
    // pre-existing pool of retained candidates is unchanged.
    //
    // Mode 'off' short-circuits to centerScore=1 above, so the gate
    // never fires regardless of tokens.
    if (focusMatched) {
      stats.passedByFocusTag = (stats.passedByFocusTag ?? 0) + 1;
    } else if (
      mode !== 'off' &&
      centerScore === 0 &&
      (mode === 'semantic' || centerTokens.size > 0)
    ) {
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

    const recencyScore =
      weights.wRecency > 0 ? computeRecencyScore(c.publishedAt, now, halfLifeMonths) : 0;
    if (weights.wRecency > 0 && !c.publishedAt && stats.recency) {
      stats.recency.missingPublishedAt++;
    }

    const final =
      weights.wCenter * centerScore + weights.wCell * bestScore + weights.wRecency * recencyScore;
    byCell.get(bestCell)!.push({
      candidate: c,
      cellIndex: bestCell,
      score: final,
      centerScore,
      cellScore: bestScore,
      recencyScore,
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

/**
 * Character 2-grams of the input string, ignoring non-letter / non-
 * digit characters. Exported shape for tests only.
 *
 * Why bigrams: Korean composite words (`"모닝루틴"`, `"비밀루틴"`) share
 * meaningful character sequences (`"루틴"`) with their root. Token-
 * level substring can't detect this because neither `"모닝루틴"` nor
 * `"루틴으로"` contains the other. Bigrams on each string produce
 * overlapping sets:
 *   `"루틴으로"` → {루틴, 틴으, 으로}
 *   `"모닝루틴"` → {모닝, 닝루, 루틴}
 *   shared   → {루틴}
 * which lets the gate fire on semantically-related composite forms.
 */
export function charBigrams(s: string): Set<string> {
  const grams = new Set<string>();
  const str = s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  for (let i = 0; i + 2 <= str.length; i++) grams.add(str.slice(i, i + 2));
  return grams;
}

/**
 * Subword-aware center-gate score. For each center token, count it as
 * "matched" when at least `SUBWORD_MIN_CENTER_MATCH` of its 2-grams
 * appear in the title's combined 2-gram bag. Returns matched-tokens
 * / total-center-tokens ∈ [0, 1].
 */
function subwordOverlap(
  centerTokenGrams: ReadonlyArray<{ token: string; grams: Set<string> }>,
  titleTokens: Set<string>
): number {
  if (centerTokenGrams.length === 0) return 0;
  // Build the union of 2-grams from all title tokens. Per-token 2-grams
  // are cheaper than a full-string 2-gram because we avoid bridging
  // across word boundaries that the user never spoke together.
  const titleGrams = new Set<string>();
  for (const tt of titleTokens) {
    for (const g of charBigrams(tt)) titleGrams.add(g);
  }
  let matched = 0;
  for (const { grams } of centerTokenGrams) {
    if (grams.size === 0) continue;
    let hits = 0;
    for (const g of grams) if (titleGrams.has(g)) hits++;
    if (hits / grams.size >= SUBWORD_MIN_CENTER_MATCH) matched++;
  }
  return matched / centerTokenGrams.length;
}

function jaccard(bodyTokens: Set<string>, subGoalTokens: Set<string>): number {
  if (bodyTokens.size === 0 || subGoalTokens.size === 0) return 0;
  let hits = 0;
  for (const t of subGoalTokens) if (bodyTokens.has(t)) hits++;
  return hits / subGoalTokens.size;
}

/**
 * Cosine similarity between two equal-length numeric vectors. Returns 0
 * for length mismatch or zero-magnitude inputs (treating them as "no
 * signal"). Clamped to [0, 1] so a freshly-generated vector with tiny
 * negative noise on a paraphrase pair doesn't under-cut the threshold.
 */
export function cosineSimilarity(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  const raw = dot / (Math.sqrt(na) * Math.sqrt(nb));
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(1, raw));
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

// Hangul Syllables block (U+AC00–U+D7A3) — Korean pre-composed syllables.
// Used to allow 1-char meaningful tokens ("뇌", "책", "돈", "법", "길")
// that the old `length >= 2` rule silently dropped. Non-Korean 1-char
// tokens (a, e, i) remain filtered to preserve noise reduction.
const HANGUL_CHAR_RE = /^[\uAC00-\uD7A3]$/;

function tokenize(text: string, language: KeywordLanguage): Set<string> {
  if (!text) return new Set();
  const stops = language === 'ko' ? KO_STOPWORDS : EN_STOPWORDS;
  const cleaned = text
    .toLowerCase()
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => !stops.has(t) && (t.length >= 2 || HANGUL_CHAR_RE.test(t)));
  return new Set(tokens);
}
