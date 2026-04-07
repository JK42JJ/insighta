/**
 * iks-scorer — pure scoring function tests
 *
 * These are deliberately small unit tests on the pure functions in ./scoring.
 * They MUST stay decoupled from the executor (no DB, no fetch, no logger).
 *
 * Phase 2a coverage:
 *   - search_demand: pass-through of norm_score (clamped)
 *   - learning_value: 0/4%/8%+ like_ratio breakpoints + null/zero fallback
 *   - placeholders (competition, trend_velocity, goal_relevance, content_performance):
 *       all return 0.5 (Phase 2b will replace these)
 *   - iks_total: weighted sum with v1 weights produces expected magnitude
 */

import {
  computeSearchDemand,
  computeLearningValue,
  computeCompetition,
  computeTrendVelocity,
  computeGoalRelevance,
  computeContentPerformance,
  computeAxes,
  computeIksTotal,
  computeIksResult,
  type SignalForScoring,
  type IksWeights,
} from '../scoring';
import { QWEN3_EMBED_DIMENSION } from '../embedding';

const baseSignal: SignalForScoring = {
  keyword: 'AI 코딩',
  raw_score: 100000,
  norm_score: 0.5,
  velocity: 0,
  metadata: { likeCount: 4000 }, // 4% like ratio
};

// helper: build a 4096d vector with all entries equal to v
function mkUnitVec(v: number): number[] {
  return new Array<number>(QWEN3_EMBED_DIMENSION).fill(v);
}

// v1 weights from the Phase 0 seed (scoring_weights row 1)
const v1Weights: IksWeights = {
  search_demand: 0.15,
  competition: 0.1,
  trend_velocity: 0.15,
  goal_relevance: 0.25,
  learning_value: 0.2,
  content_performance: 0.15,
};

describe('scoring — search_demand', () => {
  it('passes through norm_score for in-range values', () => {
    expect(computeSearchDemand({ ...baseSignal, norm_score: 0 })).toBe(0);
    expect(computeSearchDemand({ ...baseSignal, norm_score: 0.5 })).toBe(0.5);
    expect(computeSearchDemand({ ...baseSignal, norm_score: 1 })).toBe(1);
  });

  it('clamps out-of-range values (defensive)', () => {
    expect(computeSearchDemand({ ...baseSignal, norm_score: -0.5 })).toBe(0);
    expect(computeSearchDemand({ ...baseSignal, norm_score: 1.5 })).toBe(1);
    expect(computeSearchDemand({ ...baseSignal, norm_score: NaN })).toBe(0);
    expect(computeSearchDemand({ ...baseSignal, norm_score: Infinity })).toBe(0);
  });
});

describe('scoring — learning_value', () => {
  it('returns 0.5 when like_ratio = 4% (anchor point)', () => {
    const v = computeLearningValue({
      ...baseSignal,
      raw_score: 100000,
      metadata: { likeCount: 4000 },
    });
    expect(v).toBeCloseTo(0.5, 2);
  });

  it('returns 1.0 when like_ratio ≥ 8% (top of curve)', () => {
    expect(
      computeLearningValue({ ...baseSignal, raw_score: 100, metadata: { likeCount: 8 } })
    ).toBe(1.0);
    expect(
      computeLearningValue({ ...baseSignal, raw_score: 100, metadata: { likeCount: 12 } })
    ).toBe(1.0); // clamped
  });

  it('returns 0.0 when likeCount = 0', () => {
    expect(
      computeLearningValue({ ...baseSignal, raw_score: 100, metadata: { likeCount: 0 } })
    ).toBe(0);
  });

  it('returns 0.5 (neutral) when likeCount is null (likes hidden by creator)', () => {
    expect(computeLearningValue({ ...baseSignal, metadata: { likeCount: null } })).toBe(0.5);
  });

  it('returns 0.5 (neutral) when metadata is null', () => {
    expect(computeLearningValue({ ...baseSignal, metadata: null })).toBe(0.5);
  });

  it('returns 0.5 (neutral) when raw_score is 0 (avoid divide-by-zero)', () => {
    expect(
      computeLearningValue({ ...baseSignal, raw_score: 0, metadata: { likeCount: 100 } })
    ).toBe(0.5);
  });
});

describe('scoring — Phase 2a placeholders', () => {
  it('competition is the 0.5 neutral placeholder until channel_subs is collected', () => {
    expect(computeCompetition(baseSignal)).toBe(0.5);
  });

  it('trend_velocity is the 0.5 neutral placeholder until ≥2 weeks of history exists', () => {
    expect(computeTrendVelocity(baseSignal)).toBe(0.5);
  });

  // computeContentPerformance still placeholder; goal_relevance now takes embedding context
  it('goal_relevance returns 0.5 placeholder when keywordEmbedding is null', () => {
    expect(computeGoalRelevance(null, mkUnitVec(0.1))).toBe(0.5);
  });

  it('goal_relevance returns 0.5 placeholder when centroid is null', () => {
    expect(computeGoalRelevance(mkUnitVec(0.1), null)).toBe(0.5);
  });

  it('goal_relevance returns 0.5 when dimensions mismatch (defensive)', () => {
    expect(computeGoalRelevance([0.1, 0.2, 0.3], mkUnitVec(0.1))).toBe(0.5);
  });

  it('goal_relevance returns 1.0 when keyword == centroid (perfect alignment)', () => {
    const v = mkUnitVec(1 / Math.sqrt(QWEN3_EMBED_DIMENSION));
    expect(computeGoalRelevance(v, v)).toBeCloseTo(1.0, 5);
  });

  it('goal_relevance returns 0.0 when keyword == -centroid (anti-aligned)', () => {
    const v = mkUnitVec(1 / Math.sqrt(QWEN3_EMBED_DIMENSION));
    const negV = v.map((x) => -x);
    expect(computeGoalRelevance(v, negV)).toBeCloseTo(0.0, 5);
  });

  it('goal_relevance returns 0.5 when vectors are orthogonal', () => {
    // Two orthogonal unit vectors: [1, 0, ..., 0] and [0, 1, 0, ..., 0]
    const a = new Array<number>(QWEN3_EMBED_DIMENSION).fill(0);
    a[0] = 1;
    const b = new Array<number>(QWEN3_EMBED_DIMENSION).fill(0);
    b[1] = 1;
    expect(computeGoalRelevance(a, b)).toBeCloseTo(0.5, 5);
  });

  it('content_performance is the 0.5 neutral placeholder until growth-rate data exists', () => {
    expect(computeContentPerformance(baseSignal)).toBe(0.5);
  });
});

describe('scoring — computeAxes', () => {
  it('returns all 6 axes for one signal', () => {
    const axes = computeAxes(baseSignal);
    expect(Object.keys(axes).sort()).toEqual(
      [
        'competition',
        'content_performance',
        'goal_relevance',
        'learning_value',
        'search_demand',
        'trend_velocity',
      ].sort()
    );
  });
});

describe('scoring — computeIksTotal', () => {
  it('returns weighted sum × 100 (design doc 0-100 scale)', () => {
    // axes: search_demand=0.5, learning_value=0.5, placeholders all 0.5 → all 0.5
    // weighted sum = 0.5 × (sum of weights) = 0.5 × 1.0 = 0.5
    // × 100 = 50.0
    const result = computeIksTotal(computeAxes(baseSignal), v1Weights);
    expect(result).toBeCloseTo(50.0, 1);
  });

  it('returns 0 when all axes are 0 (defensive)', () => {
    const zeros = {
      search_demand: 0,
      competition: 0,
      trend_velocity: 0,
      goal_relevance: 0,
      learning_value: 0,
      content_performance: 0,
    };
    expect(computeIksTotal(zeros, v1Weights)).toBe(0);
  });

  it('returns 100 when all axes are 1 with weights summing to 1.0', () => {
    const ones = {
      search_demand: 1,
      competition: 1,
      trend_velocity: 1,
      goal_relevance: 1,
      learning_value: 1,
      content_performance: 1,
    };
    expect(computeIksTotal(ones, v1Weights)).toBe(100);
  });

  it('rounds to 2 decimal places (stability for downstream comparisons)', () => {
    const axes = computeAxes({ ...baseSignal, norm_score: 0.333333 });
    const total = computeIksTotal(axes, v1Weights);
    // Verify only 2 decimal precision
    expect(Math.round(total * 100)).toBe(total * 100);
  });
});

describe('scoring — computeIksResult (end-to-end)', () => {
  it('returns axes + iks_total in one call', () => {
    const result = computeIksResult(baseSignal, v1Weights);
    expect(result.search_demand).toBe(0.5);
    expect(result.learning_value).toBeCloseTo(0.5, 2);
    expect(result.iks_total).toBeCloseTo(50.0, 1);
  });
});
