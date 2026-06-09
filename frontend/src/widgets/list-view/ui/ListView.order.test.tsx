/**
 * CP498 PR3c — ListView must render cards in the order the HOST gives them.
 *
 * Regression guard for the relevance-sort bug: CardListView (the host) applies
 * the user's sortMode chip (latest/oldest/title/relevance); ListView previously
 * re-sorted the `cards` prop by `sortOrder` internally, silently overriding ALL
 * host sorts (off-target cards floated to the top under "관련도순"). The fix is
 * `const sortedCards = cards` — render as given. If anyone re-adds an internal
 * sort, this test breaks.
 *
 * The virtualizer is mocked to materialize every row (happy-dom has no layout
 * height, so the real virtualizer would render nothing).
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ListView } from './ListView';
import type { InsightCard } from '@/entities/card/model/types';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    scrollToIndex: () => {},
    getTotalSize: () => count * 56,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: 56,
        start: index * 56,
      })),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

function card(id: string, sortOrder: number, relevancePct: number): InsightCard {
  return {
    id,
    videoUrl: `https://example.com/${id}`,
    title: id,
    thumbnail: '',
    userNote: '',
    createdAt: new Date('2026-01-01'),
    cellIndex: 0,
    levelId: 'root',
    sortOrder,
    relevancePct,
  } as InsightCard;
}

describe('ListView — respects host order (no internal re-sort)', () => {
  it('renders in given array order even when sortOrder disagrees (the bug)', () => {
    // Host already sorted by relevance DESC → [82, 72, 5]. Their sortOrder is the
    // REVERSE (2,1,0): the old internal `a.sortOrder - b.sortOrder` would have
    // floated the relevance-5 card to the top. DOM order must equal input order.
    const cards = [card('rel-82', 2, 82), card('rel-72', 1, 72), card('off-5', 0, 5)];
    const { container } = render(
      <ListView cards={cards} activeCardId={null} onCardSelect={() => {}} />
    );
    const text = container.textContent || '';
    const iHigh = text.indexOf('rel-82');
    const iMid = text.indexOf('rel-72');
    const iLow = text.indexOf('off-5');
    expect(iHigh).toBeGreaterThanOrEqual(0);
    expect(iHigh).toBeLessThan(iMid); // 82 before 72
    expect(iMid).toBeLessThan(iLow); // 72 before 5  → host DESC preserved
  });
});
