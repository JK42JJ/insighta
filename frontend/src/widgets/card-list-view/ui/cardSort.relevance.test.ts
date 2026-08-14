/**
 * "관련도순" comparator contract (P3 Stage 2, CP513 James finalize).
 *
 *   - higher relevancePct ranks first;
 *   - a real 0 is a score (ranks above any lower/proxied value);
 *   - NULL-relevance cards are NOT dumped to the bottom — they fall back to a
 *     recency proxy (createdAt) so a fresh unscored card interleaves near the
 *     mid tier (cap 60, below 추천 70 / 핵심 80), and an old unscored card fades
 *     toward 0. `makeRelevanceComparator(nowMs)` is pure (now is threaded).
 *   - ties break by id ascending — stable across refetch.
 */
import { describe, it, expect } from 'vitest';
import { makeRelevanceComparator, relevanceSortValue } from './CardListView';
import type { InsightCard } from '@/entities/card/model/types';

const NOW = new Date('2026-07-08T00:00:00Z').getTime();
const cmp = makeRelevanceComparator(NOW);
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000);

function card(
  id: string,
  relevancePct: number | null | undefined,
  createdAt = daysAgo(200)
): InsightCard {
  return {
    id,
    videoUrl: `https://x/${id}`,
    title: id,
    thumbnail: '',
    userNote: '',
    createdAt,
    cellIndex: 0,
    levelId: 'root',
    relevancePct,
  } as InsightCard;
}

describe('relevance comparator — DESC, NULL interleaved by recency', () => {
  it('orders scored cards by relevancePct descending', () => {
    const arr = [card('off-low', 5), card('rel-high', 82), card('mid', 62)];
    expect([...arr].sort(cmp).map((c) => c.id)).toEqual(['rel-high', 'mid', 'off-low']);
  });

  it('an OLD unscored card sinks toward the bottom (proxy → 0), below scored cards', () => {
    const arr = [card('null-old', null, daysAgo(200)), card('off-low', 5), card('mid', 62)];
    // null-old proxy ≈ 0 (>90d) → below 5 and 62.
    expect([...arr].sort(cmp).map((c) => c.id)).toEqual(['mid', 'off-low', 'null-old']);
  });

  it('a FRESH unscored card interleaves (NOT bottom) — above low scores, below high', () => {
    const arr = [
      card('rel-high', 82),
      card('null-fresh', null, daysAgo(0)), // proxy = 60
      card('off-low', 5),
    ];
    // 82 > 60(fresh null) > 5 → fresh null must sit in the MIDDLE, not last.
    expect([...arr].sort(cmp).map((c) => c.id)).toEqual(['rel-high', 'null-fresh', 'off-low']);
  });

  it('recency proxy is capped below the 추천/핵심 tiers', () => {
    // A fresh null (60) never outranks a real 70+ score.
    expect(relevanceSortValue(card('n', null, daysAgo(0)), NOW)).toBeLessThan(70);
    expect(relevanceSortValue(card('n', null, daysAgo(0)), NOW)).toBeGreaterThan(0);
  });

  it('ties (equal relevancePct) break by id ascending — stable across refetch', () => {
    const a = [card('z-id', 72), card('a-id', 72), card('m-id', 72)];
    const b = [card('m-id', 72), card('z-id', 72), card('a-id', 72)];
    expect([...a].sort(cmp).map((c) => c.id)).toEqual(['a-id', 'm-id', 'z-id']);
    expect([...b].sort(cmp).map((c) => c.id)).toEqual(['a-id', 'm-id', 'z-id']);
  });
});
