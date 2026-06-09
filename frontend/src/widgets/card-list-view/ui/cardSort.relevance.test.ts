/**
 * CP498 PR3c — "관련도순" comparator: DESC, NULLS LAST.
 *
 * Locks the ordering contract against a sign-flip / null-handling regression:
 *   - higher relevancePct ranks first;
 *   - cards with null/undefined relevancePct sink to the bottom (never removed).
 */
import { describe, it, expect } from 'vitest';
import { compareByRelevanceDesc } from './CardListView';
import type { InsightCard } from '@/entities/card/model/types';

function card(id: string, relevancePct: number | null | undefined): InsightCard {
  return {
    id,
    videoUrl: `https://x/${id}`,
    title: id,
    thumbnail: '',
    userNote: '',
    createdAt: new Date('2026-01-01'),
    cellIndex: 0,
    levelId: 'root',
    relevancePct,
  } as InsightCard;
}

describe('compareByRelevanceDesc — DESC NULLS LAST', () => {
  it('orders by relevancePct descending, unscored last', () => {
    const arr = [
      card('off-low', 5),
      card('null-a', null),
      card('rel-high', 82),
      card('undef', undefined),
      card('mid', 62),
    ];
    const sorted = [...arr].sort(compareByRelevanceDesc).map((c) => c.id);
    // 82 > 62 > 5 > (null/undefined at the bottom, in any order among themselves)
    expect(sorted.slice(0, 3)).toEqual(['rel-high', 'mid', 'off-low']);
    expect(sorted.slice(3).sort()).toEqual(['null-a', 'undef']);
  });

  it('a real 0 still ranks above null (0 is a score, null is "unscored")', () => {
    const sorted = [card('null', null), card('zero', 0)]
      .sort(compareByRelevanceDesc)
      .map((c) => c.id);
    expect(sorted).toEqual(['zero', 'null']);
  });

  it('mirrors the measured fixed-sample ordering (relevant cluster above off-target)', () => {
    // From the 1-mandala gate: relevant 72-82 must all rank above off-target 5-62.
    const arr = [
      card('off-젠레스', 5),
      card('rel-8가지', 82),
      card('off-수능체대', 62),
      card('rel-결심', 72),
      card('off-미식', 15),
      card('rel-성공이유', 72),
    ];
    const sorted = [...arr].sort(compareByRelevanceDesc).map((c) => c.id);
    const firstThree = new Set(sorted.slice(0, 3));
    expect(firstThree).toEqual(new Set(['rel-8가지', 'rel-결심', 'rel-성공이유']));
  });
});
