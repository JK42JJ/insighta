/**
 * useVideoStream — binary-insert sorting regression (CP416 Phase A)
 *
 * Pins the "relevance desc" invariant for the SSE arrival buffer. User
 * directive: cards must stream in by relevance, not arrival order, so
 * the top-N viewport always shows the most relevant cards regardless
 * of when they land from the pipeline.
 */

import { describe, test, expect } from 'vitest';
import { insertByScoreDesc } from '@/features/recommendation-feed/model/useVideoStream';
import type { RecommendationItem } from '@/features/recommendation-feed/model/useRecommendations';

function mk(id: string, recScore: number): RecommendationItem {
  return {
    id,
    videoId: `v-${id}`,
    title: `title-${id}`,
    channel: null,
    thumbnail: null,
    durationSec: null,
    recScore,
    cellIndex: null,
    cellLabel: null,
    keyword: 'k',
    source: 'auto_recommend',
    recReason: null,
  };
}

function scores(list: RecommendationItem[]): number[] {
  return list.map((i) => i.recScore);
}

describe('insertByScoreDesc', () => {
  test('inserts into empty list', () => {
    const out = insertByScoreDesc([], mk('a', 0.5));
    expect(scores(out)).toEqual([0.5]);
  });

  test('descending arrival stays ordered', () => {
    let list: RecommendationItem[] = [];
    list = insertByScoreDesc(list, mk('a', 0.9));
    list = insertByScoreDesc(list, mk('b', 0.5));
    list = insertByScoreDesc(list, mk('c', 0.1));
    expect(scores(list)).toEqual([0.9, 0.5, 0.1]);
  });

  test('ascending arrival re-sorts to desc', () => {
    let list: RecommendationItem[] = [];
    list = insertByScoreDesc(list, mk('a', 0.1));
    list = insertByScoreDesc(list, mk('b', 0.5));
    list = insertByScoreDesc(list, mk('c', 0.9));
    expect(scores(list)).toEqual([0.9, 0.5, 0.1]);
    expect(list.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  test('interleaved arrival keeps sorted', () => {
    const arrivals = [0.3, 0.8, 0.1, 0.9, 0.5, 0.2, 0.7];
    let list: RecommendationItem[] = [];
    arrivals.forEach((s, i) => {
      list = insertByScoreDesc(list, mk(`id-${i}`, s));
    });
    const sorted = [...arrivals].sort((a, b) => b - a);
    expect(scores(list)).toEqual(sorted);
  });

  test('tie — stable, earlier arrival stays above', () => {
    let list: RecommendationItem[] = [];
    list = insertByScoreDesc(list, mk('first', 0.5));
    list = insertByScoreDesc(list, mk('second', 0.5));
    list = insertByScoreDesc(list, mk('third', 0.5));
    expect(list.map((i) => i.id)).toEqual(['first', 'second', 'third']);
  });

  test('tie with higher-score item pushed to top', () => {
    let list: RecommendationItem[] = [];
    list = insertByScoreDesc(list, mk('low-1', 0.2));
    list = insertByScoreDesc(list, mk('low-2', 0.2));
    list = insertByScoreDesc(list, mk('top', 0.9));
    expect(list.map((i) => i.id)).toEqual(['top', 'low-1', 'low-2']);
  });

  test('does not mutate original list', () => {
    const original: RecommendationItem[] = [mk('a', 0.8), mk('b', 0.4)];
    const out = insertByScoreDesc(original, mk('c', 0.6));
    expect(original.length).toBe(2);
    expect(scores(original)).toEqual([0.8, 0.4]);
    expect(scores(out)).toEqual([0.8, 0.6, 0.4]);
  });

  test('100 random arrivals end up fully sorted', () => {
    const arrivals = Array.from({ length: 100 }, (_, i) => Math.sin(i) * 0.5 + 0.5);
    let list: RecommendationItem[] = [];
    arrivals.forEach((s, i) => {
      list = insertByScoreDesc(list, mk(`v-${i}`, s));
    });
    const sorted = [...arrivals].sort((a, b) => b - a);
    expect(scores(list)).toEqual(sorted);
  });
});
