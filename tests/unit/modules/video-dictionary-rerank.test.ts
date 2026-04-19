import { applySemanticRerank } from '../../../src/modules/video-dictionary/rerank';
import type {
  RerankableSlot,
  SemanticRankResult,
} from '../../../src/modules/video-dictionary/types';

type Slot = RerankableSlot & { videoId: string; cellIndex: number; score: number };

function makeSlots(): Slot[] {
  return [
    { videoId: 'a', cellIndex: 0, score: 0.4 },
    { videoId: 'b', cellIndex: 0, score: 0.8 },
    { videoId: 'c', cellIndex: 1, score: 0.5 },
  ];
}

describe('applySemanticRerank', () => {
  test('null cosines — passthrough, no score mutation, re-sorts by original score', () => {
    const ranks: SemanticRankResult = new Map([
      ['a', null],
      ['b', null],
      ['c', null],
    ]);
    const { slots, trace } = applySemanticRerank(makeSlots(), ranks, { alpha: 0.6, beta: 0.4 });

    expect(slots.map((s) => s.videoId)).toEqual(['b', 'c', 'a']);
    expect(slots.map((s) => s.score)).toEqual([0.8, 0.5, 0.4]);
    expect(trace).toEqual({ candidatesIn: 3, candidatesScored: 0, avgCosine: 0 });
  });

  test('all cosines present — α·score + β·cosine blended and re-sorted', () => {
    const ranks: SemanticRankResult = new Map([
      ['a', 0.9], // blended = 0.6*0.4 + 0.4*0.9 = 0.60
      ['b', 0.2], // blended = 0.6*0.8 + 0.4*0.2 = 0.56
      ['c', 0.5], // blended = 0.6*0.5 + 0.4*0.5 = 0.50
    ]);
    const { slots, trace } = applySemanticRerank(makeSlots(), ranks, { alpha: 0.6, beta: 0.4 });

    expect(slots.map((s) => s.videoId)).toEqual(['a', 'b', 'c']);
    expect(slots.map((s) => s.score)[0]).toBeCloseTo(0.6, 4);
    expect(slots.map((s) => s.score)[1]).toBeCloseTo(0.56, 4);
    expect(slots.map((s) => s.score)[2]).toBeCloseTo(0.5, 4);
    expect(trace.candidatesScored).toBe(3);
    expect(trace.avgCosine).toBeCloseTo((0.9 + 0.2 + 0.5) / 3, 4);
  });

  test('partial nulls — blended where present, passthrough where null', () => {
    const ranks: SemanticRankResult = new Map([
      ['a', 1.0], // blended = 0.6*0.4 + 0.4*1.0 = 0.64
      ['b', null], // passthrough 0.8
      ['c', 0.1], // blended = 0.6*0.5 + 0.4*0.1 = 0.34
    ]);
    const { slots, trace } = applySemanticRerank(makeSlots(), ranks, { alpha: 0.6, beta: 0.4 });

    expect(slots.map((s) => s.videoId)).toEqual(['b', 'a', 'c']);
    const scores = slots.map((s) => s.score);
    expect(scores[0]).toBe(0.8);
    expect(scores[1]).toBeCloseTo(0.64, 4);
    expect(scores[2]).toBeCloseTo(0.34, 4);
    expect(trace.candidatesScored).toBe(2);
    expect(trace.avgCosine).toBeCloseTo((1.0 + 0.1) / 2, 4);
  });

  test('α=1, β=0 — emergency rollback: identical to passthrough for blended slots', () => {
    const ranks: SemanticRankResult = new Map([
      ['a', 0.9],
      ['b', 0.2],
      ['c', 0.5],
    ]);
    const { slots } = applySemanticRerank(makeSlots(), ranks, { alpha: 1, beta: 0 });

    // blended = 1·score + 0·cosine = score, so order matches pre-filter
    expect(slots.map((s) => s.videoId)).toEqual(['b', 'c', 'a']);
    expect(slots.map((s) => s.score)).toEqual([0.8, 0.5, 0.4]);
  });

  test('scores stay clamped to [0, 1] even if blend overflows', () => {
    const slots: Slot[] = [{ videoId: 'x', cellIndex: 0, score: 0.9 }];
    const ranks: SemanticRankResult = new Map([['x', 0.9]]);
    // alpha + beta > 1 would produce ~1.8 pre-clamp
    const { slots: out } = applySemanticRerank(slots, ranks, { alpha: 1, beta: 1 });
    const outScore = out.map((s) => s.score)[0];
    expect(outScore).toBe(1);
  });

  test('empty input — empty output, zero trace', () => {
    const { slots, trace } = applySemanticRerank([], new Map(), { alpha: 0.6, beta: 0.4 });
    expect(slots).toEqual([]);
    expect(trace).toEqual({ candidatesIn: 0, candidatesScored: 0, avgCosine: 0 });
  });

  test('input array is not mutated', () => {
    const input = makeSlots();
    const snapshot = JSON.stringify(input);
    const ranks: SemanticRankResult = new Map([['a', 0.9]]);
    applySemanticRerank(input, ranks, { alpha: 0.6, beta: 0.4 });
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
